// Minimal Prometheus exposition writer. Avoids pulling in
// prometheus/client_golang for parity with the rest of the project's
// "no heavy CDP wrappers / no heavy clients" stance — the format is
// a few hundred lines of text.
package main

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
)

type metric interface {
	name() string
	help() string
	mtype() string
	writeBody(w io.Writer)
}

// Registry is a thread-safe collection of metrics.
type Registry struct {
	mu  sync.Mutex
	all []metric
}

func NewRegistry() *Registry { return &Registry{} }

func (r *Registry) register(m metric) {
	r.mu.Lock()
	r.all = append(r.all, m)
	r.mu.Unlock()
}

// Render writes all metrics to w in stable order.
func (r *Registry) Render(w io.Writer) {
	r.mu.Lock()
	all := append([]metric(nil), r.all...)
	r.mu.Unlock()
	for _, m := range all {
		fmt.Fprintf(w, "# HELP %s %s\n", m.name(), escapeHelp(m.help()))
		fmt.Fprintf(w, "# TYPE %s %s\n", m.name(), m.mtype())
		m.writeBody(w)
	}
}

func escapeHelp(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}

func escapeLabel(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}

// labelKey builds a stable, sorted "k1=v1,k2=v2" string from a label map
// to use as a series identifier.
func labelKey(m map[string]string) string {
	if len(m) == 0 {
		return ""
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(m[k])
	}
	return b.String()
}

func writeLabels(w io.Writer, lbls map[string]string) {
	if len(lbls) == 0 {
		return
	}
	keys := make([]string, 0, len(lbls))
	for k := range lbls {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Fprint(w, "{")
	for i, k := range keys {
		if i > 0 {
			fmt.Fprint(w, ",")
		}
		fmt.Fprintf(w, "%s=\"%s\"", k, escapeLabel(lbls[k]))
	}
	fmt.Fprint(w, "}")
}

// ─── Gauge ──────────────────────────────────────────────────────────────

type Gauge struct {
	n, h string
	mu   sync.Mutex
	vals map[string]*labeledValue
}

type labeledValue struct {
	labels map[string]string
	value  float64
}

func (r *Registry) NewGauge(name, help string) *Gauge {
	g := &Gauge{n: name, h: help, vals: map[string]*labeledValue{}}
	r.register(g)
	return g
}

func (g *Gauge) name() string  { return g.n }
func (g *Gauge) help() string  { return g.h }
func (g *Gauge) mtype() string { return "gauge" }

func (g *Gauge) Set(v float64, labels map[string]string) {
	k := labelKey(labels)
	g.mu.Lock()
	defer g.mu.Unlock()
	if existing, ok := g.vals[k]; ok {
		existing.value = v
		return
	}
	g.vals[k] = &labeledValue{labels: cloneLabels(labels), value: v}
}

func (g *Gauge) writeBody(w io.Writer) {
	g.mu.Lock()
	keys := make([]string, 0, len(g.vals))
	for k := range g.vals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := g.vals[k]
		fmt.Fprint(w, g.n)
		writeLabels(w, v.labels)
		fmt.Fprintf(w, " %s\n", formatFloat(v.value))
	}
	g.mu.Unlock()
}

// ─── Counter ────────────────────────────────────────────────────────────

type Counter struct {
	n, h string
	mu   sync.Mutex
	vals map[string]*labeledValue
}

func (r *Registry) NewCounter(name, help string) *Counter {
	c := &Counter{n: name, h: help, vals: map[string]*labeledValue{}}
	r.register(c)
	return c
}

func (c *Counter) name() string  { return c.n }
func (c *Counter) help() string  { return c.h }
func (c *Counter) mtype() string { return "counter" }

func (c *Counter) Add(amount float64, labels map[string]string) {
	if amount < 0 {
		return // counters never decrease
	}
	k := labelKey(labels)
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.vals[k]; ok {
		existing.value += amount
		return
	}
	c.vals[k] = &labeledValue{labels: cloneLabels(labels), value: amount}
}

// SetCumulative replaces the counter value (used when CDP reports the
// running total directly, e.g. Performance.LayoutDuration).
func (c *Counter) SetCumulative(v float64, labels map[string]string) {
	if v < 0 {
		return
	}
	k := labelKey(labels)
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.vals[k]; ok {
		existing.value = v
		return
	}
	c.vals[k] = &labeledValue{labels: cloneLabels(labels), value: v}
}

func (c *Counter) writeBody(w io.Writer) {
	c.mu.Lock()
	keys := make([]string, 0, len(c.vals))
	for k := range c.vals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := c.vals[k]
		fmt.Fprint(w, c.n)
		writeLabels(w, v.labels)
		fmt.Fprintf(w, " %s\n", formatFloat(v.value))
	}
	c.mu.Unlock()
}

// ─── helpers ────────────────────────────────────────────────────────────

func cloneLabels(m map[string]string) map[string]string {
	if len(m) == 0 {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// formatFloat keeps the spec-compliant representation: "+Inf", "-Inf",
// "NaN" if applicable, otherwise %g with enough precision.
func formatFloat(v float64) string {
	if v != v {
		return "NaN"
	}
	if v > 1e308 {
		return "+Inf"
	}
	if v < -1e308 {
		return "-Inf"
	}
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%g", v)
}
