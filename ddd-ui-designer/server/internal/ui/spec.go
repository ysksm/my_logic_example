// Package ui holds IR2: the derived UI specification.
package ui

// Pattern identifies one of the canonical screen patterns.
type Pattern string

const (
	P1ListModal    Pattern = "P1" // list with modal detail/edit
	P2ListDetail   Pattern = "P2" // list -> separate detail/edit screen
	P3MasterDetail Pattern = "P3" // master-detail single screen
	P4Wizard       Pattern = "P4" // multi-step wizard
	P5SingleForm   Pattern = "P5" // singleton form
)

// ScreenKind labels what a screen represents.
type ScreenKind string

const (
	KindList     ScreenKind = "list"
	KindDetail   ScreenKind = "detail"
	KindEdit     ScreenKind = "edit"
	KindCreate   ScreenKind = "create"
	KindModal    ScreenKind = "modal"
	KindMaster   ScreenKind = "master"
	KindWizard   ScreenKind = "wizard"
	KindForm     ScreenKind = "form"
	KindConfirm  ScreenKind = "confirm"
	KindWizStep  ScreenKind = "wizard-step"
	KindReview   ScreenKind = "wizard-review"
	KindSettings ScreenKind = "settings"
)

// Component is a recursive form/UI element.
type Component struct {
	Type     string                 `json:"type"`
	Bind     string                 `json:"bind,omitempty"`
	Label    string                 `json:"label,omitempty"`
	Props    map[string]interface{} `json:"props,omitempty"`
	Children []Component            `json:"children,omitempty"`
}

// Screen is one node in the navigation graph.
type Screen struct {
	ID            string      `json:"id"`
	Kind          ScreenKind  `json:"kind"`
	Title         string      `json:"title"`
	AggregateRef  string      `json:"aggregateRef"`
	EntityRef     string      `json:"entityRef,omitempty"`
	ParentScreen  string      `json:"parentScreen,omitempty"`
	Components    []Component `json:"components"`
	StepIndex     int         `json:"stepIndex,omitempty"`
}

// Transition is an edge in the screen graph.
type Transition struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Event string `json:"event"`
}

// AggregatePlan describes which pattern was applied to one aggregate plus its
// generated screens. Useful for UI display and debugging the rule engine.
type AggregatePlan struct {
	AggregateRef string   `json:"aggregateRef"`
	Pattern      Pattern  `json:"pattern"`
	Reason       string   `json:"reason"`
	ScreenIDs    []string `json:"screenIds"`
	NavLabel     string   `json:"navLabel"`
}

// AppSpec is the complete derived UI document (IR2).
type AppSpec struct {
	DomainID    string          `json:"domainId"`
	DomainName  string          `json:"domainName"`
	Plans       []AggregatePlan `json:"plans"`
	Screens     []Screen        `json:"screens"`
	Transitions []Transition    `json:"transitions"`
	NavRoots    []string        `json:"navRoots"` // initial screen id per aggregate
}
