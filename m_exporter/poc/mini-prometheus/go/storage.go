package main

import (
	"hash/fnv"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Sample is one observation: timestamp in milliseconds since epoch + value.
type Sample struct {
	T int64
	V float64
}

// Labels is a sorted list of name=value pairs. Two equal Labels share a series.
type Labels []Label

type Label struct{ Name, Value string }

func (l Labels) Len() int           { return len(l) }
func (l Labels) Less(i, j int) bool { return l[i].Name < l[j].Name }
func (l Labels) Swap(i, j int)      { l[i], l[j] = l[j], l[i] }

func (l Labels) Get(name string) string {
	for _, kv := range l {
		if kv.Name == name {
			return kv.Value
		}
	}
	return ""
}

func (l Labels) Has(name string) bool {
	for _, kv := range l {
		if kv.Name == name {
			return true
		}
	}
	return false
}

// Map returns a fresh map[name]value (used for JSON output).
func (l Labels) Map() map[string]string {
	m := make(map[string]string, len(l))
	for _, kv := range l {
		m[kv.Name] = kv.Value
	}
	return m
}

// WithoutName returns a copy with __name__ stripped.
func (l Labels) WithoutName() Labels {
	out := make(Labels, 0, len(l))
	for _, kv := range l {
		if kv.Name == "__name__" {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// hashKey returns a stable string used as series key.
func (l Labels) hashKey() string {
	var b strings.Builder
	for _, kv := range l {
		b.WriteString(kv.Name)
		b.WriteByte('=')
		b.WriteString(kv.Value)
		b.WriteByte(0)
	}
	return b.String()
}

func (l Labels) Equal(o Labels) bool {
	if len(l) != len(o) {
		return false
	}
	for i := range l {
		if l[i] != o[i] {
			return false
		}
	}
	return true
}

func labelsHash(l Labels) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(l.hashKey()))
	return h.Sum64()
}

// Series is a single time series with a bounded ring buffer of samples.
type Series struct {
	id       uint64
	Labels   Labels
	mu       sync.RWMutex
	samples  []Sample
	capacity int
	head     int // index of next write
	size     int
}

func newSeries(id uint64, lbls Labels, capacity int) *Series {
	return &Series{
		id:       id,
		Labels:   lbls,
		samples:  make([]Sample, capacity),
		capacity: capacity,
	}
}

// Append adds a sample. If timestamp is older than the latest, the sample is dropped.
func (s *Series) Append(ts int64, v float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.size > 0 {
		last := (s.head - 1 + s.capacity) % s.capacity
		if ts <= s.samples[last].T {
			return
		}
	}
	s.samples[s.head] = Sample{T: ts, V: v}
	s.head = (s.head + 1) % s.capacity
	if s.size < s.capacity {
		s.size++
	}
}

// rangeSamples returns a copy of samples with t in (start, end] (exclusive start, inclusive end).
// PromQL range selectors use this semantic.
func (s *Series) rangeSamples(start, end int64) []Sample {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Sample, 0, s.size)
	for i := 0; i < s.size; i++ {
		idx := (s.head - s.size + i + s.capacity) % s.capacity
		t := s.samples[idx].T
		if t > start && t <= end {
			out = append(out, s.samples[idx])
		}
	}
	return out
}

// latestBefore returns the most recent sample with t <= ts.
func (s *Series) latestBefore(ts int64) (Sample, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := s.size - 1; i >= 0; i-- {
		idx := (s.head - s.size + i + s.capacity) % s.capacity
		if s.samples[idx].T <= ts {
			return s.samples[idx], true
		}
	}
	return Sample{}, false
}

// Storage is a tiny in-memory TSDB.
type Storage struct {
	capacity int

	mu          sync.RWMutex
	series      map[string]*Series // hashKey -> series
	postings    map[string]map[uint64]struct{}
	nameValues  map[string]map[string]struct{} // labelName -> set of values
	nextID      uint64
	allMetricNs map[string]struct{}
}

func NewStorage(capacity int) *Storage {
	return &Storage{
		capacity:    capacity,
		series:      make(map[string]*Series),
		postings:    make(map[string]map[uint64]struct{}),
		nameValues:  make(map[string]map[string]struct{}),
		allMetricNs: make(map[string]struct{}),
	}
}

// getOrCreate returns the series for the given (sorted) Labels.
func (st *Storage) getOrCreate(lbls Labels) *Series {
	key := lbls.hashKey()
	st.mu.RLock()
	s, ok := st.series[key]
	st.mu.RUnlock()
	if ok {
		return s
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if s, ok = st.series[key]; ok {
		return s
	}
	st.nextID++
	s = newSeries(st.nextID, lbls, st.capacity)
	st.series[key] = s
	for _, kv := range lbls {
		pkey := kv.Name + "=" + kv.Value
		set, ok := st.postings[pkey]
		if !ok {
			set = make(map[uint64]struct{})
			st.postings[pkey] = set
		}
		set[s.id] = struct{}{}
		nv, ok := st.nameValues[kv.Name]
		if !ok {
			nv = make(map[string]struct{})
			st.nameValues[kv.Name] = nv
		}
		nv[kv.Value] = struct{}{}
		if kv.Name == "__name__" {
			st.allMetricNs[kv.Value] = struct{}{}
		}
	}
	return s
}

// Append stores a sample under (metricName, sortedLabels).
func (st *Storage) Append(metric string, extra Labels, ts int64, v float64) {
	lbls := make(Labels, 0, len(extra)+1)
	lbls = append(lbls, Label{Name: "__name__", Value: metric})
	lbls = append(lbls, extra...)
	sort.Sort(lbls)
	s := st.getOrCreate(lbls)
	s.Append(ts, v)
}

// Matcher operators
type MatchType int

const (
	MatchEqual MatchType = iota
	MatchNotEqual
	MatchRegexp
	MatchNotRegexp
)

type Matcher struct {
	Name  string
	Type  MatchType
	Value string
	re    *regexp.Regexp
}

func NewMatcher(t MatchType, name, value string) (*Matcher, error) {
	m := &Matcher{Name: name, Type: t, Value: value}
	if t == MatchRegexp || t == MatchNotRegexp {
		// PromQL regex is anchored.
		re, err := regexp.Compile("^(?:" + value + ")$")
		if err != nil {
			return nil, err
		}
		m.re = re
	}
	return m, nil
}

func (m *Matcher) Matches(v string) bool {
	switch m.Type {
	case MatchEqual:
		return v == m.Value
	case MatchNotEqual:
		return v != m.Value
	case MatchRegexp:
		return m.re.MatchString(v)
	case MatchNotRegexp:
		return !m.re.MatchString(v)
	}
	return false
}

// Select returns all series matching the given matchers (AND).
func (st *Storage) Select(matchers []*Matcher) []*Series {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]*Series, 0)
	for _, s := range st.series {
		ok := true
		for _, m := range matchers {
			v := s.Labels.Get(m.Name)
			if !m.Matches(v) {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, s)
		}
	}
	return out
}

// LabelNames returns all known label names.
func (st *Storage) LabelNames() []string {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]string, 0, len(st.nameValues))
	for n := range st.nameValues {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// LabelValues returns all values for a given label name.
func (st *Storage) LabelValues(name string) []string {
	st.mu.RLock()
	defer st.mu.RUnlock()
	set := st.nameValues[name]
	out := make([]string, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}
