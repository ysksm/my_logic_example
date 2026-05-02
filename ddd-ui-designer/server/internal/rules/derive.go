// Package rules turns IR1 (domain) into IR2 (ui spec) by applying the
// canonical screen-pattern selection rules described in the design doc.
package rules

import (
	"fmt"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/domain"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/ui"
)

// Config tunes the decision thresholds. Externalising these makes the rules
// configurable per project without recompiling.
type Config struct {
	SmallFormFieldLimit int // <= -> P1 list+modal
	WizardFieldLimit    int // > -> P4 wizard
}

// Default returns the baseline thresholds used by the design doc.
func Default() Config {
	return Config{SmallFormFieldLimit: 5, WizardFieldLimit: 20}
}

// Derive turns a DomainModel into an AppSpec.
func Derive(d domain.DomainModel, cfg Config) ui.AppSpec {
	spec := ui.AppSpec{DomainID: d.ID, DomainName: d.Name}
	for _, ag := range d.Aggregates {
		plan := planFor(ag, cfg)
		screens, transitions, root := generateForPattern(ag, plan.Pattern)
		plan.ScreenIDs = idsOf(screens)
		plan.NavLabel = ag.Name
		spec.Plans = append(spec.Plans, plan)
		spec.Screens = append(spec.Screens, screens...)
		spec.Transitions = append(spec.Transitions, transitions...)
		if root != "" {
			spec.NavRoots = append(spec.NavRoots, root)
		}
	}
	for _, svc := range d.Services {
		// Service buttons are placed on the parent aggregate's primary screen.
		// We emit a synthetic "confirm" screen if Confirm=true.
		if svc.Confirm {
			id := "svc_" + svc.AggregateRef + "_" + svc.Name + "_confirm"
			spec.Screens = append(spec.Screens, ui.Screen{
				ID:           id,
				Kind:         ui.KindConfirm,
				Title:        svc.Name + " - 確認",
				AggregateRef: svc.AggregateRef,
				Components:   []ui.Component{{Type: "ConfirmDialog", Label: svc.Name + " を実行しますか？"}},
			})
		}
	}
	return spec
}

func planFor(ag domain.Aggregate, cfg Config) ui.AggregatePlan {
	// 1. explicit hint always wins
	if ag.Hint.Pattern != "" {
		return ui.AggregatePlan{
			AggregateRef: ag.Name,
			Pattern:      ui.Pattern(ag.Hint.Pattern),
			Reason:       "uiHint.pattern で明示指定",
		}
	}
	// 2. singleton -> P5
	if ag.IsSingleton {
		return ui.AggregatePlan{
			AggregateRef: ag.Name,
			Pattern:      ui.P5SingleForm,
			Reason:       "isSingleton=true",
		}
	}
	fieldCount := totalFieldCount(ag, ag.Root)
	hasChildren := len(ag.Root.Children) > 0
	switch {
	case hasChildren && fieldCount > cfg.WizardFieldLimit:
		return ui.AggregatePlan{ag.Name, ui.P4Wizard, fmt.Sprintf("子Entityあり かつ 総フィールド数 %d > %d", fieldCount, cfg.WizardFieldLimit), nil, ""}
	case hasChildren:
		return ui.AggregatePlan{ag.Name, ui.P3MasterDetail, "子Entityあり (Master-Detail)", nil, ""}
	case fieldCount <= cfg.SmallFormFieldLimit:
		return ui.AggregatePlan{ag.Name, ui.P1ListModal, fmt.Sprintf("子なし かつ フィールド数 %d ≤ %d", fieldCount, cfg.SmallFormFieldLimit), nil, ""}
	default:
		return ui.AggregatePlan{ag.Name, ui.P2ListDetail, fmt.Sprintf("子なし かつ フィールド数 %d", fieldCount), nil, ""}
	}
}

// totalFieldCount expands VO fields recursively (subfields are flattened in IR2).
func totalFieldCount(ag domain.Aggregate, e domain.Entity) int {
	n := 0
	for _, f := range e.Fields {
		if f.Type == domain.FieldVO {
			if vo := ag.FindVO(f.VOTypeRef); vo != nil && !vo.IsIdentifier {
				n += len(vo.Fields)
				continue
			}
		}
		n++
	}
	return n
}

func idsOf(screens []ui.Screen) []string {
	out := make([]string, len(screens))
	for i, s := range screens {
		out[i] = s.ID
	}
	return out
}

// ----- screen generation per pattern --------------------------------------

func generateForPattern(ag domain.Aggregate, p ui.Pattern) ([]ui.Screen, []ui.Transition, string) {
	switch p {
	case ui.P5SingleForm:
		return genP5(ag)
	case ui.P1ListModal:
		return genP1(ag)
	case ui.P2ListDetail:
		return genP2(ag)
	case ui.P3MasterDetail:
		return genP3(ag)
	case ui.P4Wizard:
		return genP4(ag)
	}
	return nil, nil, ""
}

func formComponents(ag domain.Aggregate, e domain.Entity) []ui.Component {
	var out []ui.Component
	for _, f := range e.Fields {
		out = append(out, fieldComponent(ag, f)...)
	}
	return out
}

func fieldComponent(ag domain.Aggregate, f domain.Field) []ui.Component {
	if f.Type == domain.FieldVO {
		vo := ag.FindVO(f.VOTypeRef)
		if vo == nil {
			return []ui.Component{{Type: "TextInput", Label: f.Name, Bind: "form." + f.Name}}
		}
		if vo.IsIdentifier {
			// Identifier VO is hidden / read-only.
			return []ui.Component{{Type: "Hidden", Bind: "form." + f.Name}}
		}
		// Flatten composite VO into a Section.
		section := ui.Component{Type: "Section", Label: f.Name, Children: nil}
		for _, sub := range vo.Fields {
			section.Children = append(section.Children,
				simpleField(sub, "form."+f.Name+"_"+sub.Name)...)
		}
		return []ui.Component{section}
	}
	return simpleField(f, "form."+f.Name)
}

func simpleField(f domain.Field, bind string) []ui.Component {
	switch f.Type {
	case domain.FieldText:
		return []ui.Component{{Type: "TextArea", Label: f.Name, Bind: bind, Props: map[string]interface{}{"required": f.Required}}}
	case domain.FieldBool:
		return []ui.Component{{Type: "Checkbox", Label: f.Name, Bind: bind}}
	case domain.FieldDate:
		return []ui.Component{{Type: "DatePicker", Label: f.Name, Bind: bind, Props: map[string]interface{}{"required": f.Required}}}
	case domain.FieldInt:
		return []ui.Component{{Type: "NumberInput", Label: f.Name, Bind: bind, Props: map[string]interface{}{"required": f.Required}}}
	case domain.FieldEnum:
		style := "Select"
		if len(f.EnumValues) <= 4 {
			style = "RadioGroup"
		}
		return []ui.Component{{Type: style, Label: f.Name, Bind: bind, Props: map[string]interface{}{"options": f.EnumValues, "required": f.Required}}}
	case domain.FieldRef:
		return []ui.Component{{Type: "RefPicker", Label: f.Name, Bind: bind, Props: map[string]interface{}{"refTo": f.RefTo, "many": f.Many, "required": f.Required}}}
	default:
		return []ui.Component{{Type: "TextInput", Label: f.Name, Bind: bind, Props: map[string]interface{}{"required": f.Required}}}
	}
}

func tableColumns(e domain.Entity) []ui.Component {
	cols := []ui.Component{}
	for _, f := range e.Fields {
		if f.Type == domain.FieldVO {
			continue // skip VO from list columns
		}
		cols = append(cols, ui.Component{Type: "Column", Label: f.Name, Bind: "row." + f.Name})
	}
	return cols
}

// P5: single screen (settings)
func genP5(ag domain.Aggregate) ([]ui.Screen, []ui.Transition, string) {
	id := "scr_" + ag.Name + "_settings"
	scr := ui.Screen{
		ID: id, Kind: ui.KindSettings, Title: ag.Name + " 設定",
		AggregateRef: ag.Name, EntityRef: ag.Root.Name,
		Components: append(formComponents(ag, ag.Root),
			ui.Component{Type: "Button", Label: "保存", Props: map[string]interface{}{"event": "save"}}),
	}
	return []ui.Screen{scr}, []ui.Transition{{From: id, To: id, Event: "save"}}, id
}

// P1: list + modal
func genP1(ag domain.Aggregate) ([]ui.Screen, []ui.Transition, string) {
	listID := "scr_" + ag.Name + "_list"
	modalID := "scr_" + ag.Name + "_modal"
	list := ui.Screen{
		ID: listID, Kind: ui.KindList, Title: ag.Name + " 一覧",
		AggregateRef: ag.Name, EntityRef: ag.Root.Name,
		Components: []ui.Component{
			{Type: "Button", Label: "新規作成", Props: map[string]interface{}{"event": "openModal"}},
			{Type: "Table", Children: tableColumns(ag.Root), Props: map[string]interface{}{"rowEvent": "openModal"}},
		},
	}
	modal := ui.Screen{
		ID: modalID, Kind: ui.KindModal, Title: ag.Name + " 詳細",
		AggregateRef: ag.Name, EntityRef: ag.Root.Name, ParentScreen: listID,
		Components: append(formComponents(ag, ag.Root),
			ui.Component{Type: "Button", Label: "保存", Props: map[string]interface{}{"event": "save"}},
			ui.Component{Type: "Button", Label: "キャンセル", Props: map[string]interface{}{"event": "close"}}),
	}
	return []ui.Screen{list, modal}, []ui.Transition{
		{listID, modalID, "openModal"},
		{modalID, listID, "save"},
		{modalID, listID, "close"},
	}, listID
}

// P2: list -> detail -> edit
func genP2(ag domain.Aggregate) ([]ui.Screen, []ui.Transition, string) {
	listID := "scr_" + ag.Name + "_list"
	detailID := "scr_" + ag.Name + "_detail"
	editID := "scr_" + ag.Name + "_edit"
	list := ui.Screen{
		ID: listID, Kind: ui.KindList, Title: ag.Name + " 一覧",
		AggregateRef: ag.Name, EntityRef: ag.Root.Name,
		Components: []ui.Component{
			{Type: "Button", Label: "新規作成", Props: map[string]interface{}{"event": "create"}},
			{Type: "Table", Children: tableColumns(ag.Root), Props: map[string]interface{}{"rowEvent": "select"}},
		},
	}
	detail := ui.Screen{
		ID: detailID, Kind: ui.KindDetail, Title: ag.Name + " 詳細",
		AggregateRef: ag.Name, EntityRef: ag.Root.Name, ParentScreen: listID,
		Components: append([]ui.Component{{Type: "ReadOnlyForm", Children: formComponents(ag, ag.Root)}},
			ui.Component{Type: "Button", Label: "編集", Props: map[string]interface{}{"event": "edit"}},
			ui.Component{Type: "Button", Label: "戻る", Props: map[string]interface{}{"event": "back"}}),
	}
	edit := ui.Screen{
		ID: editID, Kind: ui.KindEdit, Title: ag.Name + " 編集",
		AggregateRef: ag.Name, EntityRef: ag.Root.Name, ParentScreen: detailID,
		Components: append(formComponents(ag, ag.Root),
			ui.Component{Type: "Button", Label: "保存", Props: map[string]interface{}{"event": "save"}},
			ui.Component{Type: "Button", Label: "キャンセル", Props: map[string]interface{}{"event": "cancel"}}),
	}
	return []ui.Screen{list, detail, edit}, []ui.Transition{
		{listID, detailID, "select"},
		{listID, editID, "create"},
		{detailID, editID, "edit"},
		{detailID, listID, "back"},
		{editID, detailID, "save"},
		{editID, detailID, "cancel"},
	}, listID
}

// P3: master-detail
func genP3(ag domain.Aggregate) ([]ui.Screen, []ui.Transition, string) {
	masterID := "scr_" + ag.Name + "_master"
	style := ag.Hint.ChildStyle
	if style == "" {
		style = "tab"
	}
	var children []ui.Component
	children = append(children, ui.Component{
		Type: "Section", Label: ag.Root.Name,
		Children: formComponents(ag, ag.Root),
	})
	for _, childName := range ag.Root.Children {
		childEnt := ag.FindEntity(childName)
		if childEnt == nil {
			continue
		}
		switch style {
		case "table":
			children = append(children, ui.Component{
				Type: "Section", Label: childName,
				Children: []ui.Component{{Type: "EditableTable", Children: tableColumns(*childEnt)}},
			})
		default: // tab or section
			children = append(children, ui.Component{
				Type: "Tab", Label: childName,
				Children: formComponents(ag, *childEnt),
			})
		}
	}
	master := ui.Screen{
		ID: masterID, Kind: ui.KindMaster, Title: ag.Name,
		AggregateRef: ag.Name, EntityRef: ag.Root.Name,
		Components: append(children, ui.Component{Type: "Button", Label: "保存", Props: map[string]interface{}{"event": "save"}}),
	}
	return []ui.Screen{master}, []ui.Transition{{From: masterID, To: masterID, Event: "save"}}, masterID
}

// P4: wizard with steps grouped by VO/section
func genP4(ag domain.Aggregate) ([]ui.Screen, []ui.Transition, string) {
	groups := groupRootIntoSteps(ag)
	var screens []ui.Screen
	var trans []ui.Transition
	for i, g := range groups {
		id := fmt.Sprintf("scr_%s_step%d", ag.Name, i+1)
		scr := ui.Screen{
			ID: id, Kind: ui.KindWizStep, Title: fmt.Sprintf("%s - Step %d: %s", ag.Name, i+1, g.label),
			AggregateRef: ag.Name, EntityRef: ag.Root.Name, StepIndex: i + 1,
			Components: append(g.components,
				ui.Component{Type: "Button", Label: "戻る", Props: map[string]interface{}{"event": "back"}},
				ui.Component{Type: "Button", Label: "次へ", Props: map[string]interface{}{"event": "next"}}),
		}
		screens = append(screens, scr)
	}
	reviewID := "scr_" + ag.Name + "_review"
	screens = append(screens, ui.Screen{
		ID: reviewID, Kind: ui.KindReview, Title: ag.Name + " - 確認",
		AggregateRef: ag.Name, EntityRef: ag.Root.Name,
		Components: []ui.Component{
			{Type: "Summary", Bind: "form"},
			{Type: "Button", Label: "戻る", Props: map[string]interface{}{"event": "back"}},
			{Type: "Button", Label: "登録", Props: map[string]interface{}{"event": "submit"}},
		},
	})
	for i := 0; i < len(groups); i++ {
		from := fmt.Sprintf("scr_%s_step%d", ag.Name, i+1)
		var to string
		if i == len(groups)-1 {
			to = reviewID
		} else {
			to = fmt.Sprintf("scr_%s_step%d", ag.Name, i+2)
		}
		trans = append(trans, ui.Transition{From: from, To: to, Event: "next"})
		if i > 0 {
			prev := fmt.Sprintf("scr_%s_step%d", ag.Name, i)
			trans = append(trans, ui.Transition{From: from, To: prev, Event: "back"})
		}
	}
	if len(groups) > 0 {
		trans = append(trans, ui.Transition{From: reviewID, To: fmt.Sprintf("scr_%s_step%d", ag.Name, len(groups)), Event: "back"})
	}
	trans = append(trans, ui.Transition{From: reviewID, To: reviewID, Event: "submit"})
	root := ""
	if len(screens) > 0 {
		root = screens[0].ID
	}
	return screens, trans, root
}

type stepGroup struct {
	label      string
	components []ui.Component
}

// groupRootIntoSteps splits the root entity's fields into wizard steps.
// Each VO becomes its own step; remaining primitives form a "基本情報" step.
func groupRootIntoSteps(ag domain.Aggregate) []stepGroup {
	var basic []ui.Component
	var groups []stepGroup
	for _, f := range ag.Root.Fields {
		if f.Type == domain.FieldVO {
			vo := ag.FindVO(f.VOTypeRef)
			if vo != nil && !vo.IsIdentifier {
				comps := []ui.Component{}
				for _, sub := range vo.Fields {
					comps = append(comps, simpleField(sub, "form."+f.Name+"_"+sub.Name)...)
				}
				groups = append(groups, stepGroup{label: f.Name, components: comps})
				continue
			}
		}
		basic = append(basic, fieldComponent(ag, f)...)
	}
	if len(basic) > 0 {
		groups = append([]stepGroup{{label: "基本情報", components: basic}}, groups...)
	}
	return groups
}
