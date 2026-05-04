// Package server hosts the HTTP+WebSocket UI for perf-investigator.
// It exposes:
//
//	GET  /api/targets          → list CDP page targets
//	POST /api/start            → start a collector
//	POST /api/stop             → stop the active collector
//	POST /api/snapshot         → on-demand Performance.getMetrics
//	GET  /api/state            → current state
//	GET  /ws                   → WebSocket stream of events
//	GET  /                     → static React UI (if embedded)
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/cdp"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/collectors"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/recorder"
)

// Hub wires collectors → recorder + WebSocket subscribers.
type Hub struct {
	mu        sync.Mutex
	collector collectors.Collector
	rec       *recorder.Recorder
	subs      map[*subscriber]struct{}
	subsMu    sync.RWMutex
	state     State
	cancel    context.CancelFunc
}

// State is the snapshot returned from /api/state.
type State struct {
	Running      bool      `json:"running"`
	Source       string    `json:"source,omitempty"`
	StartedAt    time.Time `json:"startedAt,omitempty"`
	EventCount   int64     `json:"eventCount"`
	RecorderPath string    `json:"recorderPath,omitempty"`
}

func NewHub(rec *recorder.Recorder) *Hub {
	return &Hub{rec: rec, subs: map[*subscriber]struct{}{}}
}

// Emit is the Sink implementation: persist + broadcast.
func (h *Hub) Emit(e events.Event) {
	if h.rec != nil {
		h.rec.Emit(e)
	}
	h.broadcast(e)
	h.mu.Lock()
	h.state.EventCount++
	h.mu.Unlock()
}

func (h *Hub) broadcast(e events.Event) {
	raw, err := json.Marshal(e)
	if err != nil {
		return
	}
	h.subsMu.RLock()
	defer h.subsMu.RUnlock()
	for s := range h.subs {
		select {
		case s.send <- raw:
		default:
			// drop; slow client
		}
	}
}

// StartParams is the JSON body of POST /api/start.
type StartParams struct {
	Source      string `json:"source"` // "raw" | "chromedp" | "rod"
	Host        string `json:"host"`
	Port        int    `json:"port"`
	TargetIndex int    `json:"targetIndex"`
	NavigateURL string `json:"navigateUrl,omitempty"`
	Network     bool   `json:"network"`
	Console     bool   `json:"console"`
	Performance bool   `json:"performance"`
	PerfMonitor bool   `json:"perfMonitor"`
	Lifecycle   bool   `json:"lifecycle"`
}

func (p StartParams) toOptions() collectors.Options {
	o := collectors.Options{
		CDPHost: p.Host, CDPPort: p.Port, TargetIndex: p.TargetIndex,
		NavigateURL:       p.NavigateURL,
		EnableNetwork:     p.Network,
		EnableConsole:     p.Console,
		EnablePerformance: p.Performance,
		EnablePerfMonitor: p.PerfMonitor,
		EnableLifecycle:   p.Lifecycle,
	}
	if o.CDPHost == "" {
		o.CDPHost = "localhost"
	}
	if o.CDPPort == 0 {
		o.CDPPort = 9222
	}
	return o
}

// Build returns the named collector.
func Build(source string, opts collectors.Options) (collectors.Collector, error) {
	switch source {
	case "raw", "":
		return collectors.NewRaw(opts), nil
	case "chromedp":
		return collectors.NewChromedp(opts), nil
	case "rod":
		return collectors.NewRod(opts), nil
	default:
		return nil, fmt.Errorf("unknown source %q", source)
	}
}

// Start launches a collector. Stops any existing one first.
func (h *Hub) Start(ctx context.Context, p StartParams) error {
	h.mu.Lock()
	if h.collector != nil {
		h.mu.Unlock()
		if err := h.Stop(); err != nil {
			return err
		}
		h.mu.Lock()
	}
	c, err := Build(p.Source, p.toOptions())
	if err != nil {
		h.mu.Unlock()
		return err
	}
	cctx, cancel := context.WithCancel(ctx)
	h.cancel = cancel
	h.mu.Unlock()

	if err := c.Start(cctx, h); err != nil {
		cancel()
		return err
	}
	h.mu.Lock()
	h.collector = c
	h.state = State{Running: true, Source: c.Name(), StartedAt: time.Now().UTC()}
	h.mu.Unlock()
	return nil
}

// Stop halts the active collector.
func (h *Hub) Stop() error {
	h.mu.Lock()
	c := h.collector
	cancel := h.cancel
	h.collector = nil
	h.cancel = nil
	h.state.Running = false
	h.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if c != nil {
		return c.Stop()
	}
	return nil
}

// Snapshot returns Performance.getMetrics from the active collector.
func (h *Hub) Snapshot(ctx context.Context) (events.PerfMetrics, error) {
	h.mu.Lock()
	c := h.collector
	h.mu.Unlock()
	if c == nil {
		return events.PerfMetrics{}, errors.New("no active collector")
	}
	return c.SnapshotMetrics(ctx)
}

// State returns a copy of current state.
func (h *Hub) State() State {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.state
	return s
}

// ─── HTTP wiring ───────────────────────────────────────────────────────

// Router builds the http.Handler. uiFS may be nil to skip serving UI.
func (h *Hub) Router(uiFS fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/targets", h.handleTargets)
	mux.HandleFunc("/api/start", h.handleStart)
	mux.HandleFunc("/api/stop", h.handleStop)
	mux.HandleFunc("/api/snapshot", h.handleSnapshot)
	mux.HandleFunc("/api/state", h.handleState)
	mux.HandleFunc("/ws", h.handleWS)
	if uiFS != nil {
		mux.Handle("/", http.FileServer(http.FS(uiFS)))
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			fmt.Fprintln(w, "perf-investigator API server")
			fmt.Fprintln(w, "endpoints: /api/targets /api/start /api/stop /api/snapshot /api/state /ws")
		})
	}
	return cors(mux)
}

func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "content-type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func (h *Hub) handleTargets(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	if host == "" {
		host = "localhost"
	}
	port := 9222
	if p := r.URL.Query().Get("port"); p != "" {
		_, _ = fmt.Sscanf(p, "%d", &port)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	targets, err := cdp.ListTargets(ctx, host, port)
	if err != nil {
		writeErr(w, err, 502)
		return
	}
	writeJSON(w, targets)
}

func (h *Hub) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var p StartParams
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeErr(w, err, 400)
		return
	}
	if err := h.Start(context.Background(), p); err != nil {
		writeErr(w, err, 500)
		return
	}
	writeJSON(w, h.State())
}

func (h *Hub) handleStop(w http.ResponseWriter, r *http.Request) {
	if err := h.Stop(); err != nil {
		writeErr(w, err, 500)
		return
	}
	writeJSON(w, h.State())
}

func (h *Hub) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	m, err := h.Snapshot(ctx)
	if err != nil {
		writeErr(w, err, 500)
		return
	}
	writeJSON(w, m)
}

func (h *Hub) handleState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, h.State())
}

// ─── WebSocket subscriber ─────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 16 * 1024,
}

type subscriber struct {
	conn *websocket.Conn
	send chan []byte
}

func (h *Hub) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s := &subscriber{conn: conn, send: make(chan []byte, 1024)}
	h.subsMu.Lock()
	h.subs[s] = struct{}{}
	h.subsMu.Unlock()

	go func() {
		defer func() {
			h.subsMu.Lock()
			delete(h.subs, s)
			h.subsMu.Unlock()
			_ = conn.Close()
		}()
		conn.SetReadLimit(1024)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case msg, ok := <-s.send:
				if !ok {
					return
				}
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(2*time.Second)); err != nil {
					return
				}
			}
		}
	}()
}
