package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
)

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

func (s *Server) handleLaunch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var p LaunchParams
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeErr(w, err, http.StatusBadRequest)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	if err := s.launchBrowser(ctx, p); err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, s.snapshotState())
}

func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	_ = s.stopCollector()
	if err := s.shutdownBrowser(); err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, s.snapshotState())
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var p StartParams
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeErr(w, err, http.StatusBadRequest)
		return
	}
	if err := s.startCollector(r.Context(), p); err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, s.snapshotState())
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if err := s.stopCollector(); err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, s.snapshotState())
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	m, err := s.snapshotMetrics(ctx)
	if err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, m)
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	port := 0
	if p := r.URL.Query().Get("port"); p != "" {
		_, _ = fmt.Sscanf(p, "%d", &port)
	}
	if host == "" || port == 0 {
		st := s.snapshotState()
		if host == "" {
			host = st.Host
		}
		if port == 0 {
			port = st.Port
		}
	}
	if host == "" || port == 0 {
		writeErr(w, fmt.Errorf("host/port required (no chromium launched)"), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	targets, err := cdp.ListTargets(ctx, host, port)
	if err != nil {
		writeErr(w, err, http.StatusBadGateway)
		return
	}
	writeJSON(w, targets)
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.snapshotState())
}

func (s *Server) handleThrottle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var p ThrottleParams
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeErr(w, err, http.StatusBadRequest)
			return
		}
	}
	cl := s.cdpClient()
	if cl == nil {
		writeErr(w, fmt.Errorf("no active collector — start observation first"), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := applyThrottling(ctx, cl, p); err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, p)
}

func (s *Server) handleRender(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var p RenderParams
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeErr(w, err, http.StatusBadRequest)
			return
		}
	}
	cl := s.cdpClient()
	if cl == nil {
		writeErr(w, fmt.Errorf("no active collector — start observation first"), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	res, err := applyRendering(ctx, cl, p)
	if err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleTraceStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var p TraceStartParams
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			writeErr(w, err, http.StatusBadRequest)
			return
		}
	}
	cl := s.cdpClient()
	if cl == nil {
		writeErr(w, fmt.Errorf("no active collector — start observation first"), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := s.tracer.start(ctx, cl, p); err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"recording": true})
}

func (s *Server) handleTraceStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	cl := s.cdpClient()
	if cl == nil {
		writeErr(w, fmt.Errorf("no active collector"), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	tf, err := s.tracer.stop(ctx, cl)
	if err != nil {
		writeErr(w, err, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(tf)
}
