package cdp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Spin up a tiny WS server that mimics the bits of CDP we use, so the
// client can be exercised without a real Chrome.
func TestClient_RoundTripAndEvent(t *testing.T) {
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		// echo one request, then push one event.
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg Message
		_ = json.Unmarshal(raw, &msg)
		resp := Message{ID: msg.ID, Result: json.RawMessage(`{"echo":"ok"}`)}
		out, _ := json.Marshal(resp)
		_ = conn.WriteMessage(websocket.TextMessage, out)
		ev := Message{Method: "Test.event", Params: json.RawMessage(`{"hello":1}`)}
		out, _ = json.Marshal(ev)
		_ = conn.WriteMessage(websocket.TextMessage, out)
		time.Sleep(50 * time.Millisecond)
	}))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cl, err := Dial(ctx, wsURL)
	if err != nil {
		t.Fatal(err)
	}
	defer cl.Close()

	var (
		gotEvent string
		wg       sync.WaitGroup
	)
	wg.Add(1)
	cl.On("Test.event", func(p json.RawMessage) {
		gotEvent = string(p)
		wg.Done()
	})

	res, err := cl.Send(ctx, "Foo.bar", map[string]any{"x": 1})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res), "ok") {
		t.Errorf("unexpected result %s", string(res))
	}
	wg.Wait()
	if !strings.Contains(gotEvent, "hello") {
		t.Errorf("expected event got %q", gotEvent)
	}
}
