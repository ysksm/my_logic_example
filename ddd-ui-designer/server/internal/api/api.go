// Package api wires HTTP handlers for the ddd-ui-designer server.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/domain"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/generate"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/rules"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/runner"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/samples"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/storage"
)

// Handler builds an http.Handler with all routes mounted.
func Handler(store *storage.Store, mgr *runner.Manager, sm *samples.Manager) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", health)
	mux.HandleFunc("/api/rules", rulesInfo)
	mux.HandleFunc("/api/domains", domainsRoot(store))
	mux.HandleFunc("/api/domains/", domainsItem(store))
	mux.HandleFunc("/api/derive", derive(store))
	mux.HandleFunc("/api/generate", generateApp(store))
	mux.HandleFunc("/api/launch", launchApp(store, mgr))
	mux.HandleFunc("/api/runs", listRuns(mgr))
	mux.HandleFunc("/api/runs/", runItem(mgr))
	mux.HandleFunc("/api/samples", listSamples(sm))
	mux.HandleFunc("/api/samples/", sampleItem(sm, store))
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

// generateApp emits a tar.gz of a runnable React+Vite project derived from
// the supplied DomainModel. Format defaults to "react" (only one supported
// for now; the field exists so we can add e.g. "html" mockups later).
func generateApp(store *storage.Store) http.HandlerFunc {
	type req struct {
		DomainID string              `json:"domainId,omitempty"`
		Domain   *domain.DomainModel `json:"domain,omitempty"`
		Config   *rules.Config       `json:"config,omitempty"`
		Format   string              `json:"format,omitempty"`
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

		format := body.Format
		if format == "" {
			format = "react"
		}
		if format != "react" {
			writeErr(w, http.StatusBadRequest, "unsupported format: "+format)
			return
		}

		files, err := generate.React(spec)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		root := slug(d.ID) + "-app"
		archive, err := generate.TarGz(files, root)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/gzip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+root+`.tar.gz"`)
		w.Header().Set("X-App-Root", root)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(archive)
	}
}

// launchApp generates files into the runner's folder and (optionally) runs
// `npm install` and `npm run dev`. Returns immediately with the initial Run
// object; callers poll /api/runs/{id} to see status transitions.
func launchApp(store *storage.Store, mgr *runner.Manager) http.HandlerFunc {
	type req struct {
		DomainID string              `json:"domainId,omitempty"`
		Domain   *domain.DomainModel `json:"domain,omitempty"`
		Config   *rules.Config       `json:"config,omitempty"`
		Install  *bool               `json:"install,omitempty"`
		Start    *bool               `json:"start,omitempty"`
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
		if d.ID == "" {
			writeErr(w, http.StatusBadRequest, "domain.id is required for launch")
			return
		}
		cfg := rules.Default()
		if body.Config != nil {
			cfg = *body.Config
		}
		spec := rules.Derive(d, cfg)
		files, err := generate.React(spec)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		opts := runner.LaunchOptions{Install: true, Start: true}
		if body.Install != nil {
			opts.Install = *body.Install
		}
		if body.Start != nil {
			opts.Start = *body.Start
		}
		run, err := mgr.Launch(d.ID, files, opts)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusAccepted, run)
	}
}

func listRuns(mgr *runner.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			writeErr(w, http.StatusMethodNotAllowed, "GET only")
			return
		}
		runs := mgr.List()
		if runs == nil {
			runs = []*runner.Run{}
		}
		writeJSON(w, http.StatusOK, runs)
	}
}

// runItem dispatches GET (status) and POST .../stop (terminate dev server).
func runItem(mgr *runner.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/runs/")
		stop := strings.HasSuffix(path, "/stop")
		id := strings.TrimSuffix(path, "/stop")
		if id == "" {
			writeErr(w, http.StatusBadRequest, "run id required")
			return
		}
		if stop {
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", "POST")
				writeErr(w, http.StatusMethodNotAllowed, "POST only")
				return
			}
			if err := mgr.Stop(id); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			run := mgr.Get(id)
			if run == nil {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			writeJSON(w, http.StatusOK, run)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET,POST")
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		run := mgr.Get(id)
		if run == nil {
			writeErr(w, http.StatusNotFound, "no such run")
			return
		}
		writeJSON(w, http.StatusOK, run)
	}
}

// listSamples returns the bundled sample summaries.
func listSamples(sm *samples.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			writeErr(w, http.StatusMethodNotAllowed, "GET only")
			return
		}
		infos, err := sm.List()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if infos == nil {
			infos = []samples.Info{}
		}
		writeJSON(w, http.StatusOK, infos)
	}
}

// sampleItem dispatches:
//   GET /api/samples/{id}        → full sample (info + domain)
//   POST /api/samples/{id}/load  → also persist the domain into storage
func sampleItem(sm *samples.Manager, store *storage.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/samples/")
		load := strings.HasSuffix(path, "/load")
		id := strings.TrimSuffix(path, "/load")
		if id == "" {
			writeErr(w, http.StatusBadRequest, "sample id required")
			return
		}
		s, err := sm.Get(id)
		if err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		if load {
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", "POST")
				writeErr(w, http.StatusMethodNotAllowed, "POST only")
				return
			}
			if err := store.Put(s.Domain); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, s.Domain)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			writeErr(w, http.StatusMethodNotAllowed, "GET only")
			return
		}
		writeJSON(w, http.StatusOK, s)
	}
}

func slug(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "ddd"
	}
	return out
}
