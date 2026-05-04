// Package web exposes the chrome_dev_tool API + WebSocket + embedded React UI
// as a single http.Handler so it can be served by `cdt serve` or wrapped by
// Wails (assetserver.Options{Handler: ...}) without changes.
package web

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/browser"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/collector"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

// Server is the long-lived state behind the HTTP handler.
type Server struct {
	mu  sync.Mutex
	col *collector.Collector
	br  *browser.Process

	state State

	subsMu sync.RWMutex
	subs   map[*subscriber]struct{}

	tracer tracer
	layers layerCollector
}

// State is the snapshot returned from /api/state.
type State struct {
	Running     bool      `json:"running"`
	Attached    bool      `json:"attached"`
	StartedAt   time.Time `json:"startedAt,omitempty"`
	EventCount  int64     `json:"eventCount"`
	Host        string    `json:"host,omitempty"`
	Port        int       `json:"port,omitempty"`
	TargetURL   string    `json:"targetUrl,omitempty"`
	BrowserPath string    `json:"browserPath,omitempty"`
}

// NewServer returns a fresh Server with no active collector.
func NewServer() *Server {
	return &Server{subs: map[*subscriber]struct{}{}}
}

// Handler returns the http.Handler combining /api, /ws and embedded UI.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/launch", s.handleLaunch)
	mux.HandleFunc("/api/shutdown", s.handleShutdown)
	mux.HandleFunc("/api/start", s.handleStart)
	mux.HandleFunc("/api/stop", s.handleStop)
	mux.HandleFunc("/api/snapshot", s.handleSnapshot)
	mux.HandleFunc("/api/list", s.handleList)
	mux.HandleFunc("/api/state", s.handleState)
	mux.HandleFunc("/api/throttle", s.handleThrottle)
	mux.HandleFunc("/api/render", s.handleRender)
	mux.HandleFunc("/api/trace/start", s.handleTraceStart)
	mux.HandleFunc("/api/trace/stop", s.handleTraceStop)
	mux.HandleFunc("/api/layers/start", s.handleLayersStart)
	mux.HandleFunc("/api/layers/stop", s.handleLayersStop)
	mux.HandleFunc("/api/layers/reasons", s.handleLayersReasons)
	mux.HandleFunc("/ws", s.handleWS)
	mux.Handle("/", spaHandler())
	return cors(mux)
}

// Close stops the collector and the browser process if any.
func (s *Server) Close() error {
	_ = s.stopCollector()
	return s.shutdownBrowser()
}

// ─── Sink (events from collector) ────────────────────────────────────────

func (s *Server) Emit(e events.Event) {
	s.broadcast(e)
	s.mu.Lock()
	s.state.EventCount++
	s.mu.Unlock()
}

// ─── Collector lifecycle ─────────────────────────────────────────────────

// StartParams is the JSON body of POST /api/start.
type StartParams struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	TargetIndex int    `json:"targetIndex"`
	NavigateURL string `json:"navigateUrl,omitempty"`
	Network     bool   `json:"network"`
	Console     bool   `json:"console"`
	Performance bool   `json:"performance"`
	PerfMs      int    `json:"perfIntervalMs,omitempty"`
}

func (s *Server) startCollector(ctx context.Context, p StartParams) error {
	_ = s.stopCollector()

	if p.Host == "" {
		p.Host = "127.0.0.1"
	}
	if p.Port == 0 {
		s.mu.Lock()
		port := s.state.Port
		s.mu.Unlock()
		if port == 0 {
			return errors.New("no port: launch chromium first or pass port")
		}
		p.Port = port
	}

	interval := time.Duration(p.PerfMs) * time.Millisecond
	c := collector.New(collector.Options{
		Host:          p.Host,
		Port:          p.Port,
		TargetIndex:   p.TargetIndex,
		NavigateURL:   p.NavigateURL,
		EnableNetwork: p.Network,
		EnableConsole: p.Console,
		EnablePerf:    p.Performance,
		PerfInterval:  interval,
	})
	if err := c.Start(ctx, collector.SinkFunc(s.Emit)); err != nil {
		return err
	}
	s.mu.Lock()
	s.col = c
	s.state.Running = true
	s.state.Attached = true
	s.state.StartedAt = time.Now().UTC()
	s.state.Host = p.Host
	s.state.Port = p.Port
	if t := c.Target(); t != nil {
		s.state.TargetURL = t.URL
	}
	s.mu.Unlock()
	// Wire tracing handlers onto the freshly attached client. The handlers
	// drop events whenever tracer.active is false, so they're harmless
	// before the first /api/trace/start.
	s.tracer.wire(c.Client())
	// Same pattern for layer events — handlers register once per attach
	// and gate themselves on layers.active.
	s.layers.wire(c.Client(), s.Emit)
	return nil
}

func (s *Server) stopCollector() error {
	s.mu.Lock()
	c := s.col
	s.col = nil
	s.state.Running = false
	s.state.Attached = false
	s.state.TargetURL = ""
	s.mu.Unlock()
	if c == nil {
		return nil
	}
	return c.Stop()
}

func (s *Server) snapshotMetrics(ctx context.Context) (events.PerfSample, error) {
	s.mu.Lock()
	c := s.col
	s.mu.Unlock()
	if c == nil {
		return events.PerfSample{}, errors.New("collector not started")
	}
	return c.SnapshotMetrics(ctx)
}

// cdpClient returns the CDP client of the active collector, or nil.
func (s *Server) cdpClient() *cdp.Client {
	s.mu.Lock()
	c := s.col
	s.mu.Unlock()
	if c == nil {
		return nil
	}
	return c.Client()
}

// ─── Browser lifecycle ───────────────────────────────────────────────────

// LaunchParams is the JSON body of POST /api/launch.
type LaunchParams struct {
	URL      string `json:"url,omitempty"`
	Headless bool   `json:"headless,omitempty"`
	ExecPath string `json:"execPath,omitempty"`
	Port     int    `json:"port,omitempty"`
}

func (s *Server) launchBrowser(ctx context.Context, p LaunchParams) error {
	_ = s.shutdownBrowser()

	proc, err := browser.Launch(ctx, browser.LaunchOptions{
		ExecPath: p.ExecPath,
		Port:     p.Port,
		Headless: p.Headless,
		URL:      p.URL,
	})
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.br = proc
	s.state.Host = "127.0.0.1"
	s.state.Port = proc.Port
	s.state.BrowserPath = proc.Binary()
	s.mu.Unlock()
	return nil
}

func (s *Server) shutdownBrowser() error {
	s.mu.Lock()
	br := s.br
	s.br = nil
	s.state.BrowserPath = ""
	if s.col == nil {
		s.state.Port = 0
		s.state.Host = ""
	}
	s.mu.Unlock()
	if br == nil {
		return nil
	}
	return br.Stop()
}

// ─── State accessor ──────────────────────────────────────────────────────

func (s *Server) snapshotState() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.state
	return st
}
