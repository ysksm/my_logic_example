package analyzer

// Stereotype classifies a node within the DDD vocabulary. The values are used
// verbatim by the UI for colouring / filtering, so they are stable identifiers
// rather than human labels.
type Stereotype string

const (
	StereotypeAggregate   Stereotype = "aggregate"
	StereotypeEntity      Stereotype = "entity"
	StereotypeValueObject Stereotype = "valueObject"
	StereotypeRepository  Stereotype = "repository"
	StereotypeService     Stereotype = "service"
	StereotypeFactory     Stereotype = "factory"
	StereotypeEvent       Stereotype = "event"
	StereotypeCommand     Stereotype = "command"
	StereotypeQuery       Stereotype = "query"
	StereotypePolicy      Stereotype = "policy"
	StereotypeEnum        Stereotype = "enum"
	StereotypeTypeAlias   Stereotype = "typeAlias"
	StereotypeInterface   Stereotype = "interface"
	StereotypeClass       Stereotype = "class"
)

type Kind string

const (
	KindClass     Kind = "class"
	KindInterface Kind = "interface"
	KindEnum      Kind = "enum"
	KindTypeAlias Kind = "typeAlias"
)

type Field struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	Optional bool     `json:"optional"`
	Readonly bool     `json:"readonly"`
	TypeRefs []string `json:"typeRefs"`
}

type Method struct {
	Name       string   `json:"name"`
	ReturnType string   `json:"returnType"`
	TypeRefs   []string `json:"typeRefs"`
}

type Node struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Kind       Kind       `json:"kind"`
	Stereotype Stereotype `json:"stereotype"`
	File       string     `json:"file"`
	Line       int        `json:"line"`
	Module     string     `json:"module"`
	Extends    []string   `json:"extends"`
	Implements []string   `json:"implements"`
	Fields     []Field    `json:"fields"`
	Methods    []Method   `json:"methods"`
	EnumValues []string   `json:"enumValues,omitempty"`
	Aggregate  string     `json:"aggregate,omitempty"`
	Exported   bool       `json:"exported"`
}

type EdgeKind string

const (
	EdgeExtends    EdgeKind = "extends"
	EdgeImplements EdgeKind = "implements"
	EdgeField      EdgeKind = "field"
	EdgeMethod     EdgeKind = "method"
	EdgeAggregate  EdgeKind = "aggregate"
)

type Edge struct {
	ID    string   `json:"id"`
	From  string   `json:"from"`
	To    string   `json:"to"`
	Kind  EdgeKind `json:"kind"`
	Label string   `json:"label,omitempty"`
}

type Module struct {
	Name  string   `json:"name"`
	Path  string   `json:"path"`
	Nodes []string `json:"nodes"`
}

type Graph struct {
	Root    string   `json:"root"`
	Nodes   []Node   `json:"nodes"`
	Edges   []Edge   `json:"edges"`
	Modules []Module `json:"modules"`
	Stats   Stats    `json:"stats"`
}

type Stats struct {
	FilesScanned int `json:"filesScanned"`
	NodeCount    int `json:"nodeCount"`
	EdgeCount    int `json:"edgeCount"`
	ModuleCount  int `json:"moduleCount"`
}
