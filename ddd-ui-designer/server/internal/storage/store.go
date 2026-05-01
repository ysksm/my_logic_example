// Package storage persists DomainModel documents as JSON files.
package storage

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/domain"
)

// Store is a thread-safe JSON-file backed repository of domain models.
type Store struct {
	dir string
	mu  sync.RWMutex
}

// New opens (creating if necessary) the data directory.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

func (s *Store) path(id string) string {
	return filepath.Join(s.dir, id+".json")
}

// List returns all stored domains, sorted by name.
func (s *Store) List() ([]domain.DomainModel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var out []domain.DomainModel
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			return nil, err
		}
		var m domain.DomainModel
		if err := json.Unmarshal(b, &m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Get reads a single domain by id.
func (s *Store) Get(id string) (domain.DomainModel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, err := os.ReadFile(s.path(id))
	if err != nil {
		return domain.DomainModel{}, err
	}
	var m domain.DomainModel
	if err := json.Unmarshal(b, &m); err != nil {
		return domain.DomainModel{}, err
	}
	return m, nil
}

// Put writes (upserts) a domain.
func (s *Store) Put(m domain.DomainModel) error {
	if m.ID == "" {
		return errors.New("domain id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(m.ID), b, 0o644)
}

// Delete removes a domain by id.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(s.path(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
