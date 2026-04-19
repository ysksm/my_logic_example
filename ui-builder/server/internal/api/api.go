// Package api wires HTTP routes onto a storage.Store.
//
// Routing is done with stdlib http.ServeMux + manual path parsing so the
// server stays dependency-free. The path layout is:
//
//	GET    /api/health
//	GET    /api/models                       list DataModels
//	POST   /api/models                       upsert one
//	DELETE /api/models/{name}
//	POST   /api/models/{name}/scaffold       generate a scaffolded App
//	GET    /api/apps                         list Apps
//	POST   /api/apps                         upsert one
//	GET    /api/apps/{id}
//	DELETE /api/apps/{id}
//	GET    /api/records/{model}              list records
//	POST   /api/records/{model}              upsert one
//	DELETE /api/records/{model}/{id}
package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ysksm/my_logic_example/ui-builder/server/internal/scaffold"
	"github.com/ysksm/my_logic_example/ui-builder/server/internal/storage"
)

// Register attaches all routes to mux.
func Register(mux *http.ServeMux, s *storage.Store) {
	h := &handler{s: s}
	mux.HandleFunc("/api/health", h.health)
	mux.HandleFunc("/api/models", h.models)
	mux.HandleFunc("/api/models/", h.modelByName) // covers /{name} and /{name}/scaffold
	mux.HandleFunc("/api/apps", h.apps)
	mux.HandleFunc("/api/apps/", h.appByID)
	mux.HandleFunc("/api/records/", h.records)
	mux.HandleFunc("/api/domains", h.domains)
	mux.HandleFunc("/api/domains/", h.domainByID)
}

// WithCORS wraps a handler with permissive CORS so the React dev server can call it.
func WithCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type handler struct{ s *storage.Store }

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (h *handler) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ----- Models -----

func (h *handler) models(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, h.s.ListModels())
	case http.MethodPost:
		var m storage.DataModel
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.s.UpsertModel(m); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, m)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *handler) modelByName(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/models/")
	parts := strings.SplitN(rest, "/", 2)
	name := parts[0]
	if name == "" {
		writeErr(w, http.StatusBadRequest, "model name required")
		return
	}
	// /api/models/{name}/scaffold
	if len(parts) == 2 && parts[1] == "scaffold" && r.Method == http.MethodPost {
		m, ok := h.s.GetModel(name)
		if !ok {
			writeErr(w, http.StatusNotFound, "model not found")
			return
		}
		app := scaffold.FromModel(m)
		if err := h.s.UpsertApp(app); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, app)
		return
	}
	switch r.Method {
	case http.MethodGet:
		m, ok := h.s.GetModel(name)
		if !ok {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeJSON(w, http.StatusOK, m)
	case http.MethodDelete:
		if err := h.s.DeleteModel(name); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ----- Apps -----

func (h *handler) apps(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, h.s.ListApps())
	case http.MethodPost:
		var a storage.App
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.s.UpsertApp(a); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, a)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *handler) appByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/apps/")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "app id required")
		return
	}
	switch r.Method {
	case http.MethodGet:
		a, ok := h.s.GetApp(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeJSON(w, http.StatusOK, a)
	case http.MethodDelete:
		if err := h.s.DeleteApp(id); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ----- Records -----

func (h *handler) records(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/records/")
	parts := strings.SplitN(rest, "/", 2)
	model := parts[0]
	if model == "" {
		writeErr(w, http.StatusBadRequest, "model required")
		return
	}
	if _, ok := h.s.GetModel(model); !ok {
		writeErr(w, http.StatusNotFound, "model not found")
		return
	}
	if len(parts) == 2 && parts[1] != "" {
		if r.Method != http.MethodDelete {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if err := h.s.DeleteRecord(model, parts[1]); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, h.s.ListRecords(model))
	case http.MethodPost:
		var it storage.Item
		if err := json.NewDecoder(r.Body).Decode(&it); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.s.UpsertRecord(model, it); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, it)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ----- Domains -----

func (h *handler) domains(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, h.s.ListDomains())
	case http.MethodPost:
		var d storage.Domain
		if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.s.UpsertDomain(d); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, d)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// /api/domains/{id} or /api/domains/{id}/scaffold
func (h *handler) domainByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/domains/")
	parts := strings.SplitN(rest, "/", 2)
	id := parts[0]
	if id == "" {
		writeErr(w, http.StatusBadRequest, "domain id required")
		return
	}
	if len(parts) == 2 && parts[1] == "scaffold" && r.Method == http.MethodPost {
		d, ok := h.s.GetDomain(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "domain not found")
			return
		}
		models := scaffold.FromDomain(d)
		for _, m := range models {
			if err := h.s.UpsertModel(m); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, models)
		return
	}
	switch r.Method {
	case http.MethodGet:
		d, ok := h.s.GetDomain(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeJSON(w, http.StatusOK, d)
	case http.MethodDelete:
		if err := h.s.DeleteDomain(id); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
