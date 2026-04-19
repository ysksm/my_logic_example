package analyzer

import (
	"path/filepath"
	"sort"
	"testing"
)

func TestAnalyzeSampleDomain(t *testing.T) {
	root, err := filepath.Abs("../../testdata/sample-domain")
	if err != nil {
		t.Fatal(err)
	}
	g, err := Analyze(root, Options{})
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if g.Stats.FilesScanned < 5 {
		t.Fatalf("expected ≥5 files scanned, got %d", g.Stats.FilesScanned)
	}

	byName := map[string]Node{}
	for _, n := range g.Nodes {
		byName[n.Name] = n
	}

	wantStereotypes := map[string]Stereotype{
		"Order":               StereotypeAggregate,
		"OrderLine":           StereotypeEntity,
		"Money":               StereotypeValueObject,
		"Currency":            StereotypeEnum,
		"OrderRepository":     StereotypeRepository,
		"CustomerRepository":  StereotypeRepository,
		"PlaceOrderService":   StereotypeService,
		"PlaceOrderCommand":   StereotypeCommand,
		"OrderPlaced":         StereotypeEvent,
		"OrderStatus":         StereotypeEnum,
		"Customer":            StereotypeAggregate,
		"Address":             StereotypeValueObject,
		"Email":               StereotypeValueObject,
	}
	for name, want := range wantStereotypes {
		n, ok := byName[name]
		if !ok {
			t.Errorf("node %q not found", name)
			continue
		}
		if n.Stereotype != want {
			t.Errorf("%s: stereotype = %s, want %s", name, n.Stereotype, want)
		}
	}

	// Order should link to OrderLine via its `lines` field.
	if !hasEdge(g, "Order", "OrderLine", EdgeField) {
		t.Error("expected Order -> OrderLine field edge")
	}
	// Order aggregate should claim OrderLine.
	if byName["OrderLine"].Aggregate != "Order" {
		t.Errorf("OrderLine.Aggregate = %q, want Order", byName["OrderLine"].Aggregate)
	}

	// Enums expose their values.
	if len(byName["OrderStatus"].EnumValues) < 3 {
		t.Errorf("OrderStatus enum values: %v", byName["OrderStatus"].EnumValues)
	}

	// Sanity: modules populated.
	if len(g.Modules) == 0 {
		t.Error("expected at least one module")
	}
	names := make([]string, 0, len(g.Modules))
	for _, m := range g.Modules {
		names = append(names, m.Name)
	}
	sort.Strings(names)
	t.Logf("modules: %v", names)
}

func hasEdge(g *Graph, fromName, toName string, kind EdgeKind) bool {
	fromIDs := map[string]bool{}
	toIDs := map[string]bool{}
	for _, n := range g.Nodes {
		if n.Name == fromName {
			fromIDs[n.ID] = true
		}
		if n.Name == toName {
			toIDs[n.ID] = true
		}
	}
	for _, e := range g.Edges {
		if e.Kind == kind && fromIDs[e.From] && toIDs[e.To] {
			return true
		}
	}
	return false
}
