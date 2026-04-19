// Package scaffold builds a default App from a DataModel, the way
// Rails' `bin/rails generate scaffold` produces controllers and views.
//
// The generated App contains four screens (list / new / show / edit)
// wired together with transitions, plus state variables that bind
// form inputs back to record fields.
package scaffold

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ysksm/my_logic_example/ui-builder/server/internal/storage"
)

// component / transition shapes mirror the React side; we keep them as
// plain maps so the frontend remains the source of truth.
type component map[string]interface{}
type screen struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Components []component `json:"components"`
}
type transition struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Event string `json:"event"`
}

// FromModel produces an App whose ID is the lowercased model name.
// Re-running it for the same model overwrites the previous scaffold.
func FromModel(m storage.DataModel) storage.App {
	id := strings.ToLower(m.Name)

	listScreen := screen{
		ID: id + "_list", Name: m.Name + " List",
		Components: []component{
			{"id": "title", "type": "Text", "props": map[string]interface{}{
				"x": 20, "y": 20, "w": 400, "h": 32,
				"text": m.Name + "s", "size": 24, "bold": true,
			}},
			{"id": "newBtn", "type": "Button", "props": map[string]interface{}{
				"x": 440, "y": 20, "w": 120, "h": 36,
				"label": "+ New " + m.Name,
			}, "events": map[string]interface{}{
				"onClick": map[string]interface{}{"action": "navigate", "target": id + "_new"},
			}},
			{"id": "table", "type": "Table", "props": map[string]interface{}{
				"x": 20, "y": 70, "w": 740, "h": 400,
				"model":   m.Name,
				"columns": columnsOf(m),
			}, "events": map[string]interface{}{
				"onRowClick": map[string]interface{}{
					"action": "navigate", "target": id + "_show",
					"setVars": map[string]interface{}{"selectedId": "$row.id"},
				},
			}},
		},
	}

	newScreen := formScreen(id+"_new", "New "+m.Name, m, false)
	editScreen := formScreen(id+"_edit", "Edit "+m.Name, m, true)
	showScreen := showScreen(id+"_show", m)

	screens := []screen{listScreen, newScreen, showScreen, editScreen}

	transitions := []transition{
		{From: id + "_list", To: id + "_new", Event: "newBtn"},
		{From: id + "_list", To: id + "_show", Event: "table"},
		{From: id + "_new", To: id + "_list", Event: "saved"},
		{From: id + "_show", To: id + "_edit", Event: "editBtn"},
		{From: id + "_show", To: id + "_list", Event: "backBtn"},
		{From: id + "_edit", To: id + "_show", Event: "saved"},
	}

	stateVars := map[string]interface{}{
		"selectedId": "",
	}

	screensJSON, _ := json.Marshal(screens)
	transJSON, _ := json.Marshal(transitions)
	varsJSON, _ := json.Marshal(stateVars)

	return storage.App{
		ID:             id,
		Name:           m.Name + " (scaffold)",
		InitialScreen:  id + "_list",
		Screens:        screensJSON,
		Transitions:    transJSON,
		StateVariables: varsJSON,
	}
}

func columnsOf(m storage.DataModel) []map[string]string {
	out := []map[string]string{{"key": "id", "label": "ID"}}
	for _, f := range m.Fields {
		out = append(out, map[string]string{"key": f.Name, "label": f.Name})
	}
	return out
}

func formScreen(id, title string, m storage.DataModel, edit bool) screen {
	comps := []component{
		{"id": "title", "type": "Text", "props": map[string]interface{}{
			"x": 20, "y": 20, "w": 400, "h": 32,
			"text": title, "size": 22, "bold": true,
		}},
	}
	y := 70
	for _, f := range m.Fields {
		comps = append(comps,
			component{"id": "lbl_" + f.Name, "type": "Text", "props": map[string]interface{}{
				"x": 20, "y": y, "w": 140, "h": 28, "text": f.Name,
			}},
			component{"id": "in_" + f.Name, "type": fieldComponent(f.Type), "props": map[string]interface{}{
				"x": 170, "y": y, "w": 320, "h": 28,
				"bind": "form." + f.Name, "placeholder": f.Name,
			}},
		)
		y += 40
	}
	saveAction := map[string]interface{}{
		"action": "saveRecord", "model": m.Name, "from": "form",
		"thenEvent": "saved",
	}
	if edit {
		saveAction["recordId"] = "$state.selectedId"
	}
	comps = append(comps,
		component{"id": "saveBtn", "type": "Button", "props": map[string]interface{}{
			"x": 170, "y": y + 10, "w": 100, "h": 36, "label": "Save", "primary": true,
		}, "events": map[string]interface{}{"onClick": saveAction}},
		component{"id": "cancelBtn", "type": "Button", "props": map[string]interface{}{
			"x": 280, "y": y + 10, "w": 100, "h": 36, "label": "Cancel",
		}, "events": map[string]interface{}{"onClick": map[string]interface{}{
			"action": "navigate", "target": strings.TrimSuffix(id, suffix(edit)) + "_list",
		}}},
	)
	return screen{ID: id, Name: title, Components: comps}
}

func suffix(edit bool) string {
	if edit {
		return "_edit"
	}
	return "_new"
}

func showScreen(id string, m storage.DataModel) screen {
	comps := []component{
		{"id": "title", "type": "Text", "props": map[string]interface{}{
			"x": 20, "y": 20, "w": 400, "h": 32,
			"text": fmt.Sprintf("%s detail", m.Name), "size": 22, "bold": true,
		}},
	}
	y := 70
	for _, f := range m.Fields {
		comps = append(comps,
			component{"id": "lbl_" + f.Name, "type": "Text", "props": map[string]interface{}{
				"x": 20, "y": y, "w": 140, "h": 28, "text": f.Name + ":", "bold": true,
			}},
			component{"id": "val_" + f.Name, "type": "Text", "props": map[string]interface{}{
				"x": 170, "y": y, "w": 320, "h": 28,
				"text": "$record." + f.Name,
			}},
		)
		y += 36
	}
	comps = append(comps,
		component{"id": "editBtn", "type": "Button", "props": map[string]interface{}{
			"x": 170, "y": y + 10, "w": 100, "h": 36, "label": "Edit", "primary": true,
		}, "events": map[string]interface{}{"onClick": map[string]interface{}{
			"action": "navigate", "target": strings.TrimSuffix(id, "_show") + "_edit",
		}}},
		component{"id": "backBtn", "type": "Button", "props": map[string]interface{}{
			"x": 280, "y": y + 10, "w": 100, "h": 36, "label": "Back",
		}, "events": map[string]interface{}{"onClick": map[string]interface{}{
			"action": "navigate", "target": strings.TrimSuffix(id, "_show") + "_list",
		}}},
	)
	return screen{ID: id, Name: m.Name + " detail", Components: comps}
}

func fieldComponent(t string) string {
	switch t {
	case "bool":
		return "Checkbox"
	case "text":
		return "Textarea"
	case "int":
		return "NumberInput"
	case "date":
		return "DateInput"
	default:
		return "Input"
	}
}
