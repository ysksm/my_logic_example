package web

import (
	"embed"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/ysksm/my_logic_example/cad-viewer/core"
)

//go:embed all:static
var embeddedFS embed.FS

// Server hosts the CAD viewer HTTP API and the embedded Babylon.js frontend.
//
// Hand the result of Handler() to Wails's AssetServer to reuse the exact same
// routes from the desktop binary — this is the keystone of the web/desktop
// architecture: there is one transport (HTTP) and one renderer (the browser /
// webview), and the Go side never needs to know which one is in use.
type Server struct {
	cfg core.Config
	mux *http.ServeMux
}

// NewServer constructs a Server with the given configuration.
func NewServer(cfg core.Config) (*Server, error) {
	s := &Server{
		cfg: cfg.Normalize(),
		mux: http.NewServeMux(),
	}
	s.setupRoutes()
	return s, nil
}

func (s *Server) setupRoutes() {
	staticFS, err := fs.Sub(embeddedFS, "static")
	if err != nil {
		slog.Error("failed to mount static FS", "error", err)
	} else {
		s.mux.Handle("GET /", http.FileServer(http.FS(staticFS)))
	}
	s.mux.HandleFunc("POST /api/cad/upload", s.handleUpload)
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
}

// Handler exposes the underlying mux for embedding (e.g. Wails AssetServer).
func (s *Server) Handler() http.Handler { return s.mux }

// Start runs an HTTP server on the given address. Used by the `serve` CLI.
func (s *Server) Start(addr string) error {
	slog.Info("cad-viewer listening", "addr", addr)
	return http.ListenAndServe(addr, s.mux)
}

// Close releases server-owned resources. Reserved for future stateful
// extensions (e.g. a parsed-mesh cache).
func (s *Server) Close() error { return nil }
