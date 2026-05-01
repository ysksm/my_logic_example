package rules

import (
	"testing"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/domain"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/ui"
)

func TestPatternSelection(t *testing.T) {
	cases := []struct {
		name string
		ag   domain.Aggregate
		want ui.Pattern
	}{
		{
			name: "singleton => P5",
			ag: domain.Aggregate{Name: "Settings", IsSingleton: true,
				Root: domain.Entity{Name: "Settings", Fields: []domain.Field{{Name: "x", Type: domain.FieldString}}}},
			want: ui.P5SingleForm,
		},
		{
			name: "small flat => P1",
			ag: domain.Aggregate{Name: "Tag",
				Root: domain.Entity{Name: "Tag", Fields: []domain.Field{
					{Name: "name", Type: domain.FieldString},
					{Name: "color", Type: domain.FieldString},
				}}},
			want: ui.P1ListModal,
		},
		{
			name: "many fields no children => P2",
			ag: domain.Aggregate{Name: "Article",
				Root: domain.Entity{Name: "Article", Fields: []domain.Field{
					{Name: "a", Type: domain.FieldString}, {Name: "b", Type: domain.FieldString},
					{Name: "c", Type: domain.FieldString}, {Name: "d", Type: domain.FieldString},
					{Name: "e", Type: domain.FieldString}, {Name: "f", Type: domain.FieldString},
				}}},
			want: ui.P2ListDetail,
		},
		{
			name: "has children => P3",
			ag: domain.Aggregate{Name: "Order",
				Root: domain.Entity{Name: "Order", Children: []string{"OrderLine"},
					Fields: []domain.Field{{Name: "status", Type: domain.FieldString}}},
				Entities: []domain.Entity{{Name: "OrderLine"}}},
			want: ui.P3MasterDetail,
		},
		{
			name: "has children & wide => P4",
			ag: domain.Aggregate{Name: "Project",
				Root: domain.Entity{Name: "Project", Children: []string{"Task"}, Fields: manyFields(25)},
				Entities: []domain.Entity{{Name: "Task"}}},
			want: ui.P4Wizard,
		},
		{
			name: "explicit hint wins",
			ag: domain.Aggregate{Name: "Whatever", Hint: domain.UIHint{Pattern: "P1"},
				Root: domain.Entity{Name: "Whatever", Fields: manyFields(30)}},
			want: ui.P1ListModal,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			plan := planFor(c.ag, Default())
			if plan.Pattern != c.want {
				t.Fatalf("got %s, want %s (%s)", plan.Pattern, c.want, plan.Reason)
			}
		})
	}
}

func TestDerivePopulatesScreens(t *testing.T) {
	d := domain.DomainModel{
		ID: "d", Name: "D",
		Aggregates: []domain.Aggregate{
			{Name: "Order",
				Root: domain.Entity{Name: "Order", Children: []string{"Line"},
					Fields: []domain.Field{{Name: "status", Type: domain.FieldString}}},
				Entities: []domain.Entity{{Name: "Line",
					Fields: []domain.Field{{Name: "qty", Type: domain.FieldInt}}}},
			},
		},
	}
	spec := Derive(d, Default())
	if len(spec.Plans) != 1 {
		t.Fatalf("plans: %d", len(spec.Plans))
	}
	if len(spec.Screens) == 0 {
		t.Fatalf("no screens")
	}
	if len(spec.NavRoots) != 1 {
		t.Fatalf("expected 1 nav root, got %d", len(spec.NavRoots))
	}
}

func TestVOFieldFlattenedInCount(t *testing.T) {
	ag := domain.Aggregate{Name: "X",
		Root: domain.Entity{Name: "X", Fields: []domain.Field{
			{Name: "id", Type: domain.FieldVO, VOTypeRef: "Id"},
			{Name: "money", Type: domain.FieldVO, VOTypeRef: "Money"},
			{Name: "label", Type: domain.FieldString},
		}},
		ValueObjects: []domain.ValueObject{
			{Name: "Id", IsIdentifier: true, Fields: []domain.Field{{Name: "value", Type: domain.FieldString}}},
			{Name: "Money", Fields: []domain.Field{
				{Name: "amount", Type: domain.FieldInt},
				{Name: "currency", Type: domain.FieldString},
			}},
		},
	}
	got := totalFieldCount(ag, ag.Root)
	// id (id-VO collapses to 1) + money expands to 2 + label = 4
	if got != 4 {
		t.Fatalf("totalFieldCount=%d want 4", got)
	}
}

func manyFields(n int) []domain.Field {
	out := make([]domain.Field, n)
	for i := range out {
		out[i] = domain.Field{Name: "f", Type: domain.FieldString}
	}
	return out
}
