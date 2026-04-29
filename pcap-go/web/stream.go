package web

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ysksm/my_logic_example/pcap-go/core"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // SPA served from same origin in production
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.mgr.Session(id); !ok {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ch := make(chan core.Packet, 512)
	lid, err := s.mgr.Subscribe(id, ch)
	if err != nil {
		_ = conn.WriteJSON(core.StreamEnvelope{Type: "error", Message: err.Error()})
		return
	}
	defer s.mgr.Unsubscribe(id, lid)

	// Reader goroutine: detect client disconnects by reading control frames.
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	pingTicker := time.NewTicker(20 * time.Second)
	defer pingTicker.Stop()

	for {
		select {
		case <-done:
			return
		case p, ok := <-ch:
			if !ok {
				return
			}
			pkt := p
			if err := conn.WriteJSON(core.StreamEnvelope{Type: "packet", Packet: &pkt}); err != nil {
				return
			}
		case <-pingTicker.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				log.Printf("ws ping: %v", err)
				return
			}
			if sess, ok := s.mgr.Session(id); ok {
				_ = conn.WriteJSON(core.StreamEnvelope{Type: "session", Session: &sess})
			}
		}
	}
}
