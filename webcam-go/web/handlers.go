package web

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/ysksm/my_logic_example/webcam-go/core"
)

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	devs, err := s.mgr.Devices()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, core.ListDevicesResponse{Devices: devs})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, core.ListSessionsResponse{Sessions: s.mgr.Sessions()})
}

func (s *Server) handleStartSession(w http.ResponseWriter, r *http.Request) {
	var req core.StartStreamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	sess, err := s.mgr.Start(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, core.StartStreamResponse{Session: sess})
}

func (s *Server) handleStopSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess, err := s.mgr.Stop(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, core.StopStreamResponse{Session: sess})
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess, ok := s.mgr.Session(id)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	stats, err := s.mgr.Stats(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	f, ok := s.mgr.LatestFrame(id)
	if !ok {
		writeError(w, http.StatusNotFound, "no frame available yet")
		return
	}
	w.Header().Set("Content-Type", f.Mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(f.Data)))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(f.Data)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
