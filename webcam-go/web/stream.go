package web

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ysksm/my_logic_example/webcam-go/core"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // SPA served same-origin in production
}

// handleStream upgrades to WebSocket and ships JPEG payloads as binary
// messages, with periodic JSON envelopes for session metadata.
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

	ch := make(chan core.Frame, 8)
	lid, err := s.mgr.Subscribe(id, ch)
	if err != nil {
		_ = conn.WriteJSON(core.StreamEnvelope{Type: "error", Message: err.Error()})
		return
	}
	defer s.mgr.Unsubscribe(id, lid)

	// Reader goroutine: detect client disconnects + handle pong frames.
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
		case f, ok := <-ch:
			if !ok {
				return
			}
			meta := core.StreamEnvelope{Type: "frame_meta", Frame: &core.Frame{
				Seq:        f.Seq,
				CapturedAt: f.CapturedAt,
				Width:      f.Width,
				Height:     f.Height,
				Mime:       f.Mime,
				Size:       f.Size,
			}}
			if err := conn.WriteJSON(meta); err != nil {
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, f.Data); err != nil {
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
