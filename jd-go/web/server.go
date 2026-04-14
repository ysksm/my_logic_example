package web

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"sync"

	"github.com/ysksm/jd-go/core"
)

//go:embed all:static all:templates
var embeddedFS embed.FS

// Server is the web dashboard server.
type Server struct {
	cfg       core.Config
	db        *core.Database
	client    *core.JiraClient
	syncState *core.SyncState
	mux       *http.ServeMux

	syncMu           sync.Mutex
	activeSyncCancel context.CancelFunc
	sseClients       map[chan SSEEvent]bool
	sseMu            sync.Mutex
}

// SSEEvent represents a Server-Sent Event.
type SSEEvent struct {
	Event string
	Data  string
}

// NewServer creates a new web server.
func NewServer(cfg core.Config) (*Server, error) {
	db, err := core.NewDatabase(cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	var client *core.JiraClient
	if cfg.JiraBaseURL != "" && cfg.JiraUsername != "" && cfg.JiraAPIToken != "" {
		client = core.NewJiraClient(cfg.JiraBaseURL, cfg.JiraUsername, cfg.JiraAPIToken)
	}

	syncState := core.NewSyncState(cfg.SyncStatePath)

	s := &Server{
		cfg:        cfg,
		db:         db,
		client:     client,
		syncState:  syncState,
		mux:        http.NewServeMux(),
		sseClients: make(map[chan SSEEvent]bool),
	}

	s.setupRoutes()
	return s, nil
}

// Close closes the server resources.
func (s *Server) Close() error {
	return s.db.Close()
}

func (s *Server) setupRoutes() {
	// Static files
	staticFS, err := fs.Sub(embeddedFS, "static")
	if err != nil {
		slog.Error("Failed to create static sub-filesystem", "error", err)
	} else {
		s.mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))
	}

	// Pages
	s.mux.HandleFunc("GET /", s.handleIndex)

	// API routes
	s.mux.HandleFunc("GET /api/projects", s.handleProjects)
	s.mux.HandleFunc("GET /api/metadata/{projectKey}", s.handleMetadata)
	s.mux.HandleFunc("GET /api/sync/status/{projectKey}", s.handleSyncStatus)
	s.mux.HandleFunc("POST /api/sync/{projectKey}", s.handleSyncStart)
	s.mux.HandleFunc("GET /api/sync/progress", s.handleSyncProgress)
	s.mux.HandleFunc("POST /api/sync/cancel", s.handleSyncCancel)
	s.mux.HandleFunc("POST /api/query", s.handleQuery)

	// Chart data API
	s.mux.HandleFunc("GET /api/charts/status/{projectKey}", s.handleChartStatus)
	s.mux.HandleFunc("GET /api/charts/priority/{projectKey}", s.handleChartPriority)
	s.mux.HandleFunc("GET /api/charts/type/{projectKey}", s.handleChartType)
	s.mux.HandleFunc("GET /api/charts/assignee/{projectKey}", s.handleChartAssignee)
	s.mux.HandleFunc("GET /api/charts/monthly/{projectKey}", s.handleChartMonthly)
	s.mux.HandleFunc("GET /api/charts/transitions/{projectKey}", s.handleChartTransitions)
	s.mux.HandleFunc("GET /api/charts/field-changes/{projectKey}", s.handleChartFieldChanges)
	s.mux.HandleFunc("GET /api/charts/daily-status/{projectKey}", s.handleChartDailyStatus)
	s.mux.HandleFunc("GET /api/charts/created-resolved/{projectKey}", s.handleChartCreatedResolved)
	s.mux.HandleFunc("GET /api/history/snapshot/{projectKey}", s.handleHistorySnapshot)
}

// Start starts the HTTP server.
func (s *Server) Start(addr string) error {
	slog.Info("Server starting", "addr", addr)
	return http.ListenAndServe(addr, s.mux)
}
