package web

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

const (
	wsSendBuffer = 1024
	wsPingPeriod = 20 * time.Second
	wsWriteWait  = 2 * time.Second
)

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 16 * 1024,
}

type subscriber struct {
	conn *websocket.Conn
	send chan []byte
}

func (s *Server) broadcast(e events.Event) {
	raw, err := json.Marshal(e)
	if err != nil {
		return
	}
	s.subsMu.RLock()
	defer s.subsMu.RUnlock()
	for sub := range s.subs {
		select {
		case sub.send <- raw:
		default:
			// Drop on overflow — slow consumer, do not block the producer.
		}
	}
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	sub := &subscriber{conn: conn, send: make(chan []byte, wsSendBuffer)}
	s.subsMu.Lock()
	s.subs[sub] = struct{}{}
	s.subsMu.Unlock()

	closeSub := func() {
		s.subsMu.Lock()
		delete(s.subs, sub)
		s.subsMu.Unlock()
		_ = conn.Close()
	}

	go func() {
		defer closeSub()
		conn.SetReadLimit(1024)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	go func() {
		ticker := time.NewTicker(wsPingPeriod)
		defer ticker.Stop()
		for {
			select {
			case msg, ok := <-sub.send:
				if !ok {
					return
				}
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(wsWriteWait)); err != nil {
					return
				}
			}
		}
	}()
}
