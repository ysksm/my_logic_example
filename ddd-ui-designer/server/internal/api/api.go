// Package api wires HTTP handlers for the ddd-ui-designer server.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/domain"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/rules"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/storage"
)

// Handler builds an http.Handler with all routes mounted.
func Handler(store *storage.Store) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", health)
	mux.HandleFunc("/api/rules", rulesInfo)
	mux.HandleFunc("/api/domains", domainsRoot(store))
	mux.HandleFunc("/api/domains/", domainsItem(store))
	mux.HandleFunc("/api/derive", derive(store))
	return cors(mux)
}

func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func rulesInfo(w http.ResponseWriter, _ *http.Request) {
	cfg := rules.Default()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config": cfg,
		"patterns": []map[string]string{
			{"id": "P1", "label": "List + Modal", "when": "子なし & フィールド数 ≤ SmallFormFieldLimit"},
			{"id": "P2", "label": "List + Detail", "when": "子なし & フィールド数 > SmallFormFieldLimit"},
			{"id": "P3", "label": "Master-Detail", "when": "子Entityあり"},
			{"id": "P4", "label": "Wizard", "when": "子Entityあり & フィールド数 > WizardFieldLimit"},
			{"id": "P5", "label": "Single Form", "when": "isSingleton=true"},
		},
	})
}

func domainsRoot(store *storage.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			items, err := store.List()
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			if items == nil {
				items = []domain.DomainModel{}
			}
			writeJSON(w, http.StatusOK, items)
		case http.MethodPost:
			var m domain.DomainModel
			if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			if m.ID == "" {
				writeErr(w, http.StatusBadRequest, "id is required")
				return
			}
			if err := store.Put(m); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, m)
		default:
			w.Header().Set("Allow", "GET,POST")
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}
}

func domainsItem(store *storage.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/domains/")
		if id == "" {
			writeErr(w, http.StatusBadRequest, "id required")
			return
		}
		switch r.Method {
		case http.MethodGet:
			m, err := store.Get(id)
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					writeErr(w, http.StatusNotFound, "not found")
					return
				}
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, m)
		case http.MethodDelete:
			if err := store.Delete(id); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.Header().Set("Allow", "GET,DELETE")
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}
}

// derive accepts either a domainId reference or an inline DomainModel and
// returns the derived AppSpec along with the planning trace.
func derive(store *storage.Store) http.HandlerFunc {
	type req struct {
		DomainID string              `json:"domainId,omitempty"`
		Domain   *domain.DomainModel `json:"domain,omitempty"`
		Config   *rules.Config       `json:"config,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeErr(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		var d domain.DomainModel
		switch {
		case body.Domain != nil:
			d = *body.Domain
		case body.DomainID != "":
			loaded, err := store.Get(body.DomainID)
			if err != nil {
				writeErr(w, http.StatusNotFound, err.Error())
				return
			}
			d = loaded
		default:
			writeErr(w, http.StatusBadRequest, "either domainId or domain must be provided")
			return
		}
		cfg := rules.Default()
		if body.Config != nil {
			cfg = *body.Config
		}
		spec := rules.Derive(d, cfg)
		writeJSON(w, http.StatusOK, spec)
	}
}
