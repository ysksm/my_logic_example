package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"
)

const snapshotVersion = 1

type snapshotFile struct {
	Version int               `json:"version"`
	SavedAt int64             `json:"saved_at_ms"`
	Series  []snapshotSeries  `json:"series"`
}

type snapshotSeries struct {
	Labels  []Label      `json:"labels"`
	Samples [][2]float64 `json:"samples"` // [t_ms, value]
}

func (st *Storage) Snapshot() ([]byte, error) {
	st.mu.RLock()
	out := snapshotFile{
		Version: snapshotVersion,
		SavedAt: time.Now().UnixMilli(),
		Series:  make([]snapshotSeries, 0, len(st.series)),
	}
	for _, s := range st.series {
		s.mu.RLock()
		samples := make([][2]float64, 0, s.size)
		for i := 0; i < s.size; i++ {
			idx := (s.head - s.size + i + s.capacity) % s.capacity
			samples = append(samples, [2]float64{float64(s.samples[idx].T), s.samples[idx].V})
		}
		out.Series = append(out.Series, snapshotSeries{
			Labels:  []Label(s.Labels),
			Samples: samples,
		})
		s.mu.RUnlock()
	}
	st.mu.RUnlock()
	return json.Marshal(out)
}

func (st *Storage) Restore(b []byte) (int, error) {
	var snap snapshotFile
	if err := json.Unmarshal(b, &snap); err != nil {
		return 0, err
	}
	if snap.Version != snapshotVersion {
		return 0, fmt.Errorf("unsupported snapshot version: %d", snap.Version)
	}
	for _, ss := range snap.Series {
		lbls := Labels(ss.Labels)
		sort.Sort(lbls)
		s := st.getOrCreate(lbls)
		for _, sa := range ss.Samples {
			s.Append(int64(sa[0]), sa[1])
		}
	}
	return len(snap.Series), nil
}

// WriteSnapshot serializes storage to path atomically (tmp + rename).
func WriteSnapshot(path string, st *Storage) error {
	data, err := st.Snapshot()
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
