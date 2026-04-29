package web

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/ysksm/my_logic_example/pcap-go/core"
)

func (s *Server) handleListInterfaces(w http.ResponseWriter, r *http.Request) {
	ifs, err := s.mgr.Interfaces()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, core.ListInterfacesResponse{Interfaces: ifs})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, core.ListSessionsResponse{Sessions: s.mgr.Sessions()})
}

func (s *Server) handleStartSession(w http.ResponseWriter, r *http.Request) {
	var req core.StartCaptureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	sess, err := s.mgr.Start(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, core.StartCaptureResponse{Session: sess})
}

func (s *Server) handleStopSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess, err := s.mgr.Stop(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, core.StopCaptureResponse{Session: sess})
}

func (s *Server) handleListPackets(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	q := r.URL.Query()
	afterSeq, _ := strconv.ParseUint(q.Get("after_seq"), 10, 64)
	limit, _ := strconv.Atoi(q.Get("limit"))

	pkts, next, err := s.mgr.Packets(id, afterSeq, limit)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, core.ListPacketsResponse{Packets: pkts, NextSeq: next})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
