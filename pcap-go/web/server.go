// Package web exposes the REST + WebSocket API and serves the SPA.
package web

import (
	"context"
	"net/http"

	"github.com/ysksm/my_logic_example/pcap-go/core"
)

// Server wraps net/http.Server with handlers wired against a core.Manager.
type Server struct {
	http *http.Server
	mgr  *core.Manager
}

// NewServer constructs a Server that delegates business logic to mgr.
func NewServer(mgr *core.Manager) *Server {
	mux := http.NewServeMux()
	s := &Server{mgr: mgr}
	s.registerRoutes(mux)
	s.http = &http.Server{Handler: logging(mux)}
	return s
}

// ListenAndServe binds the server to addr and blocks until shutdown.
func (s *Server) ListenAndServe(addr string) error {
	s.http.Addr = addr
	if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}
