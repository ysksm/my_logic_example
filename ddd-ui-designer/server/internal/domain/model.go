// Package domain holds IR1: the DDD domain meta-model used as the single
// source of truth from which UI specs are derived.
package domain

// FieldType enumerates the primitive and composite types a field can have.
type FieldType string

const (
	FieldString FieldType = "string"
	FieldText   FieldType = "text"
	FieldInt    FieldType = "int"
	FieldBool   FieldType = "bool"
	FieldDate   FieldType = "date"
	FieldEnum   FieldType = "enum"
	FieldRef    FieldType = "ref" // reference to another aggregate root
	FieldVO     FieldType = "vo"  // embedded value object
)

// Field describes one attribute on an Entity or ValueObject.
type Field struct {
	Name       string    `json:"name"`
	Type       FieldType `json:"type"`
	Required   bool      `json:"required,omitempty"`
	EnumValues []string  `json:"enumValues,omitempty"` // for FieldEnum
	RefTo      string    `json:"refTo,omitempty"`      // aggregate name, for FieldRef
	VOTypeRef  string    `json:"voTypeRef,omitempty"`  // value object name, for FieldVO
	Many       bool      `json:"many,omitempty"`       // collection
}

// ValueObject is an immutable composite type.
type ValueObject struct {
	Name         string  `json:"name"`
	Fields       []Field `json:"fields"`
	IsIdentifier bool    `json:"isIdentifier,omitempty"`
}

// Entity has identity and may own child entities.
type Entity struct {
	Name     string   `json:"name"`
	Fields   []Field  `json:"fields"`
	Children []string `json:"children,omitempty"` // child entity names within the same aggregate
	IsRoot   bool     `json:"isRoot,omitempty"`
}

// UIHint is an optional annotation that overrides automatic pattern selection.
type UIHint struct {
	Pattern    string `json:"pattern,omitempty"`    // P1..P5, empty = auto
	FormStyle  string `json:"formStyle,omitempty"`  // inline | modal | dialog
	ChildStyle string `json:"childStyle,omitempty"` // tab | section | table
}

// Aggregate is a consistency boundary: one root entity + owned entities + VOs.
type Aggregate struct {
	Name         string        `json:"name"`
	IsSingleton  bool          `json:"isSingleton,omitempty"`
	Root         Entity        `json:"root"`
	Entities     []Entity      `json:"entities,omitempty"`
	ValueObjects []ValueObject `json:"valueObjects,omitempty"`
	Hint         UIHint        `json:"uiHint,omitempty"`
}

// Service represents a domain service or use-case action.
type Service struct {
	Name         string  `json:"name"`
	AggregateRef string  `json:"aggregateRef"`
	Inputs       []Field `json:"inputs,omitempty"`
	Confirm      bool    `json:"confirm,omitempty"`
}

// DomainModel is the top-level IR1 document.
type DomainModel struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Aggregates []Aggregate `json:"aggregates"`
	Services   []Service   `json:"services,omitempty"`
}

// FindEntity locates an entity (root or child) by name within an aggregate.
func (a Aggregate) FindEntity(name string) *Entity {
	if a.Root.Name == name {
		return &a.Root
	}
	for i := range a.Entities {
		if a.Entities[i].Name == name {
			return &a.Entities[i]
		}
	}
	return nil
}

// FindVO locates a value object by name.
func (a Aggregate) FindVO(name string) *ValueObject {
	for i := range a.ValueObjects {
		if a.ValueObjects[i].Name == name {
			return &a.ValueObjects[i]
		}
	}
	return nil
}
