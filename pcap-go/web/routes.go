package web

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"
)

//go:embed all:static
var staticFS embed.FS

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// REST
	mux.HandleFunc("GET /api/v1/interfaces", s.handleListInterfaces)
	mux.HandleFunc("GET /api/v1/sessions", s.handleListSessions)
	mux.HandleFunc("POST /api/v1/sessions", s.handleStartSession)
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", s.handleStopSession)
	mux.HandleFunc("GET /api/v1/sessions/{id}/packets", s.handleListPackets)

	// WebSocket
	mux.HandleFunc("GET /api/v1/sessions/{id}/stream", s.handleStream)

	// Health
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// SPA static assets (fallback to index.html for unknown paths).
	mux.Handle("/", spaHandler())
}

func spaHandler() http.Handler {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Printf("static fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Block API paths from leaking to the SPA fallback.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		// If the requested file does not exist, serve index.html.
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(sub, path); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}
