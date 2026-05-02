package samples

import (
	"testing"
	"testing/fstest"
)

func TestListAndGet(t *testing.T) {
	fsys := fstest.MapFS{
		"data/a.json": &fstest.MapFile{Data: []byte(`{
			"id":"a","name":"A","description":"first",
			"aggregates":[{"name":"X","root":{"name":"X","isRoot":true,"fields":[]}}]
		}`)},
		"data/b.json": &fstest.MapFile{Data: []byte(`{
			"id":"b","name":"B","description":"second",
			"aggregates":[
				{"name":"X","root":{"name":"X","isRoot":true,"fields":[]}},
				{"name":"Y","root":{"name":"Y","isRoot":true,"fields":[]}}
			]
		}`)},
		"data/skip.txt": &fstest.MapFile{Data: []byte("ignored")},
	}
	m := New(fsys, "data")
	infos, err := m.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 2 {
		t.Fatalf("want 2, got %d", len(infos))
	}
	if infos[0].ID != "a" || infos[0].AggregateCount != 1 {
		t.Errorf("a info wrong: %+v", infos[0])
	}
	if infos[1].ID != "b" || infos[1].AggregateCount != 2 {
		t.Errorf("b info wrong: %+v", infos[1])
	}

	s, err := m.Get("b")
	if err != nil {
		t.Fatal(err)
	}
	if s.Domain.Name != "B" {
		t.Errorf("got name %q", s.Domain.Name)
	}
	if s.Description != "second" {
		t.Errorf("got desc %q", s.Description)
	}

	if _, err := m.Get("missing"); err == nil {
		t.Error("expected error for missing id")
	}
}

func TestUnknownFieldsIgnored(t *testing.T) {
	fsys := fstest.MapFS{
		"data/x.json": &fstest.MapFile{Data: []byte(`{
			"id":"x","name":"X","description":"d","extraTopLevel":42,
			"aggregates":[{"name":"X","root":{"name":"X","isRoot":true,"fields":[]}}]
		}`)},
	}
	m := New(fsys, "data")
	infos, err := m.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 1 || infos[0].Description != "d" {
		t.Fatalf("unexpected: %+v", infos)
	}
}
