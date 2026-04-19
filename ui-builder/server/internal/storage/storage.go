// Package storage is a tiny JSON-file backed persistence layer.
// It is intentionally simple: each "collection" (models, apps, records)
// is one JSON file that is rewritten atomically on every change.
package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Store holds independent collections behind one mutex per file.
type Store struct {
	dir string

	mu      sync.RWMutex
	models  map[string]DataModel       // key = model name
	apps    map[string]App             // key = app id
	records map[string]map[string]Item // model name -> record id -> item
	domains map[string]Domain          // key = domain id
}

// DataModel is a Rails-like schema definition.
type DataModel struct {
	Name   string  `json:"name"`
	Fields []Field `json:"fields"`
}

// Field is a single column on a DataModel.
type Field struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // string|text|int|bool|date|ref
	Required bool   `json:"required,omitempty"`
	Ref      string `json:"ref,omitempty"` // referenced model name when Type=ref
}

// App is the metadata document the React builder edits.
// Components and screens are intentionally untyped (json.RawMessage) so the
// frontend may evolve the shape without server changes.
type App struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	InitialScreen  string          `json:"initialScreen"`
	Screens        json.RawMessage `json:"screens"`
	Transitions    json.RawMessage `json:"transitions"`
	StateVariables json.RawMessage `json:"stateVariables,omitempty"`
}

// Item is a single user record stored against a DataModel.
type Item struct {
	ID     string                 `json:"id"`
	Values map[string]interface{} `json:"values"`
}

// ----- DDD domain model -----
//
// Domain holds a DDD-style design: ValueObjects (immutable, used for IDs and
// general types), Entities (have identity), and Aggregates (consistency
// boundaries). Layout positions for the ER diagram are stored alongside.

// DomainAttribute is one slot inside a VO or Entity. Type may be a primitive
// (string|int|float|bool|date|datetime|text) or the name of another VO.
type DomainAttribute struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required,omitempty"`
	List     bool   `json:"list,omitempty"`
}

// DomainReference is an Entity → Entity association.
type DomainReference struct {
	Name        string `json:"name"`
	Target      string `json:"target"`
	Cardinality string `json:"cardinality"` // "one" | "many"
}

// ValueObject is a DDD VO. IsIdentifier marks IDs (e.g. UserId).
type ValueObject struct {
	Name         string            `json:"name"`
	IsIdentifier bool              `json:"isIdentifier,omitempty"`
	Attributes   []DomainAttribute `json:"attributes"`
}

// Entity has an identity (a VO referenced by IdentifierType).
type Entity struct {
	Name           string            `json:"name"`
	IdentifierName string            `json:"identifierName"` // e.g. "id"
	IdentifierType string            `json:"identifierType"` // VO name
	Attributes     []DomainAttribute `json:"attributes"`
	References     []DomainReference `json:"references,omitempty"`
}

// Aggregate is a consistency boundary rooted at one Entity.
type Aggregate struct {
	Name     string   `json:"name"`
	Root     string   `json:"root"`              // entity name
	Members  []string `json:"members,omitempty"` // entities included beyond the root
}

// Position is a node coordinate on the ER canvas.
type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// Domain is the top-level DDD document.
type Domain struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	ValueObjects []ValueObject       `json:"valueObjects"`
	Entities     []Entity            `json:"entities"`
	Aggregates   []Aggregate         `json:"aggregates"`
	Layout       map[string]Position `json:"layout,omitempty"` // node name -> position
}

// New opens (or creates) a Store rooted at dir.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		dir:     dir,
		models:  map[string]DataModel{},
		apps:    map[string]App{},
		records: map[string]map[string]Item{},
		domains: map[string]Domain{},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name+".json") }

func (s *Store) load() error {
	if err := readJSON(s.path("models"), &s.models); err != nil {
		return err
	}
	if err := readJSON(s.path("apps"), &s.apps); err != nil {
		return err
	}
	if err := readJSON(s.path("records"), &s.records); err != nil {
		return err
	}
	return readJSON(s.path("domains"), &s.domains)
}

func (s *Store) saveLocked(name string, v interface{}) error {
	tmp := s.path(name) + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, s.path(name))
}

// readJSON reads a JSON file into out. Missing files are not an error.
func readJSON(path string, out interface{}) error {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(b) == 0 {
		return nil
	}
	return json.Unmarshal(b, out)
}

// ----- DataModels -----

func (s *Store) ListModels() []DataModel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]DataModel, 0, len(s.models))
	for _, m := range s.models {
		out = append(out, m)
	}
	return out
}

func (s *Store) GetModel(name string) (DataModel, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.models[name]
	return m, ok
}

func (s *Store) UpsertModel(m DataModel) error {
	if m.Name == "" {
		return fmt.Errorf("model name required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.models[m.Name] = m
	return s.saveLocked("models", s.models)
}

func (s *Store) DeleteModel(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.models, name)
	delete(s.records, name)
	if err := s.saveLocked("models", s.models); err != nil {
		return err
	}
	return s.saveLocked("records", s.records)
}

// ----- Apps -----

func (s *Store) ListApps() []App {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]App, 0, len(s.apps))
	for _, a := range s.apps {
		out = append(out, a)
	}
	return out
}

func (s *Store) GetApp(id string) (App, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.apps[id]
	return a, ok
}

func (s *Store) UpsertApp(a App) error {
	if a.ID == "" {
		return fmt.Errorf("app id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.apps[a.ID] = a
	return s.saveLocked("apps", s.apps)
}

func (s *Store) DeleteApp(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.apps, id)
	return s.saveLocked("apps", s.apps)
}

// ----- Records -----

func (s *Store) ListRecords(model string) []Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	bucket := s.records[model]
	out := make([]Item, 0, len(bucket))
	for _, it := range bucket {
		out = append(out, it)
	}
	return out
}

func (s *Store) UpsertRecord(model string, it Item) error {
	if it.ID == "" {
		return fmt.Errorf("record id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.records[model]; !ok {
		s.records[model] = map[string]Item{}
	}
	s.records[model][it.ID] = it
	return s.saveLocked("records", s.records)
}

func (s *Store) DeleteRecord(model, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if bucket, ok := s.records[model]; ok {
		delete(bucket, id)
	}
	return s.saveLocked("records", s.records)
}

// ----- Domains (DDD) -----

func (s *Store) ListDomains() []Domain {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Domain, 0, len(s.domains))
	for _, d := range s.domains {
		out = append(out, d)
	}
	return out
}

func (s *Store) GetDomain(id string) (Domain, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, ok := s.domains[id]
	return d, ok
}

func (s *Store) UpsertDomain(d Domain) error {
	if d.ID == "" {
		return fmt.Errorf("domain id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.domains[d.ID] = d
	return s.saveLocked("domains", s.domains)
}

func (s *Store) DeleteDomain(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.domains, id)
	return s.saveLocked("domains", s.domains)
}
