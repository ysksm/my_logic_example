// Package samples reads bundled DomainModel JSON files. The embed.FS is
// supplied by the main package (since `//go:embed` cannot escape the
// package directory and the source files live next to main.go).
package samples

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/domain"
)

// Info is a lightweight summary used by the listing endpoint.
type Info struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	AggregateCount int    `json:"aggregateCount"`
}

// Sample bundles the summary plus the loaded DomainModel.
type Sample struct {
	Info
	Domain domain.DomainModel `json:"domain"`
}

// Manager loads and caches samples from an embedded filesystem rooted at
// `subdir`. Reads are tiny so we just cache once on first use.
type Manager struct {
	fsys   fs.FS
	subdir string
	mu     sync.Mutex
	cache  []Sample
}

// New constructs a Manager. `subdir` is the directory inside fsys that
// contains the *.json sample files (e.g. "samples").
func New(fsys fs.FS, subdir string) *Manager {
	return &Manager{fsys: fsys, subdir: subdir}
}

func (m *Manager) ensureLoaded() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cache != nil {
		return nil
	}
	entries, err := fs.ReadDir(m.fsys, m.subdir)
	if err != nil {
		return fmt.Errorf("read samples dir: %w", err)
	}
	var loaded []Sample
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			continue
		}
		s, err := readSample(m.fsys, filepath.Join(m.subdir, e.Name()))
		if err != nil {
			return fmt.Errorf("read %s: %w", e.Name(), err)
		}
		loaded = append(loaded, *s)
	}
	sort.Slice(loaded, func(i, j int) bool { return loaded[i].Name < loaded[j].Name })
	m.cache = loaded
	return nil
}

// List returns all bundled samples' summaries.
func (m *Manager) List() ([]Info, error) {
	if err := m.ensureLoaded(); err != nil {
		return nil, err
	}
	out := make([]Info, len(m.cache))
	for i, s := range m.cache {
		out[i] = s.Info
	}
	return out, nil
}

// Get returns the full Sample for a given id, or an error if not found.
func (m *Manager) Get(id string) (*Sample, error) {
	if err := m.ensureLoaded(); err != nil {
		return nil, err
	}
	for i := range m.cache {
		if m.cache[i].ID == id {
			s := m.cache[i]
			return &s, nil
		}
	}
	return nil, fmt.Errorf("sample not found: %s", id)
}

// readSample is split out so it's easy to unit-test against a fake fsys.
func readSample(fsys fs.FS, path string) (*Sample, error) {
	b, err := fs.ReadFile(fsys, path)
	if err != nil {
		return nil, err
	}
	// Pull description out without polluting DomainModel; DomainModel parsing
	// silently ignores the field.
	var meta struct {
		Description string `json:"description"`
	}
	_ = json.Unmarshal(b, &meta)

	var d domain.DomainModel
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, err
	}
	return &Sample{
		Info: Info{
			ID:             d.ID,
			Name:           d.Name,
			Description:    meta.Description,
			AggregateCount: len(d.Aggregates),
		},
		Domain: d,
	}, nil
}
