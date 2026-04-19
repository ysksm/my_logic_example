package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/ysksm/my_logic_example/ddd-diagram-generator/server/internal/analyzer"
)

type Server struct {
	// roots lists paths the user is allowed to analyze. When empty any path
	// works — that's fine for local development.
	Roots []string
}

func New(roots []string) *Server {
	return &Server{Roots: roots}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.health)
	mux.HandleFunc("/api/analyze", s.analyze)
	return withCORS(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type analyzeRequest struct {
	Path         string   `json:"path"`
	IncludeTests bool     `json:"includeTests"`
	ExcludeDirs  []string `json:"excludeDirs"`
}

func (s *Server) analyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req analyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	abs, err := filepath.Abs(req.Path)
	if err != nil {
		http.Error(w, "bad path: "+err.Error(), http.StatusBadRequest)
		return
	}
	if !s.allowed(abs) {
		http.Error(w, "path is outside the allowed roots", http.StatusForbidden)
		return
	}
	graph, err := analyzer.Analyze(abs, analyzer.Options{
		IncludeTests: req.IncludeTests,
		ExcludeDirs:  req.ExcludeDirs,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, graph)
}

func (s *Server) allowed(abs string) bool {
	if len(s.Roots) == 0 {
		return true
	}
	for _, root := range s.Roots {
		if r, err := filepath.Abs(root); err == nil {
			if strings.HasPrefix(abs, r) {
				return true
			}
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}
