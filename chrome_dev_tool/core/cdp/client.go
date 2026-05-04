// Package cdp is a small, dependency-light Chrome DevTools Protocol client.
// It speaks JSON over WebSocket directly so we never depend on rod / chromedp.
package cdp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// Target is one page/worker exposed by Chrome's /json endpoint.
type Target struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	Title                string `json:"title"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

// Version is the payload returned by /json/version.
type Version struct {
	Browser              string `json:"Browser"`
	ProtocolVersion      string `json:"Protocol-Version"`
	UserAgent            string `json:"User-Agent"`
	V8Version            string `json:"V8-Version"`
	WebKitVersion        string `json:"WebKit-Version"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

// FetchVersion calls http://host:port/json/version.
func FetchVersion(ctx context.Context, host string, port int) (*Version, error) {
	var v Version
	if err := getJSON(ctx, fmt.Sprintf("http://%s:%d/json/version", host, port), &v); err != nil {
		return nil, err
	}
	return &v, nil
}

// ListTargets calls http://host:port/json.
func ListTargets(ctx context.Context, host string, port int) ([]Target, error) {
	var out []Target
	if err := getJSON(ctx, fmt.Sprintf("http://%s:%d/json", host, port), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func getJSON(ctx context.Context, url string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("GET %s: %s — %s", url, res.Status, body)
	}
	return json.NewDecoder(res.Body).Decode(dst)
}

// Message is the wire frame for a CDP request / response / event.
type Message struct {
	ID     int             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RPCError       `json:"error,omitempty"`
}

// RPCError is the JSON-RPC error payload.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data,omitempty"`
}

func (e *RPCError) Error() string { return fmt.Sprintf("cdp: %d %s", e.Code, e.Message) }

// EventHandler receives the params of one CDP event.
type EventHandler func(params json.RawMessage)

// Client is a single WebSocket connection to a CDP target.
type Client struct {
	conn     *websocket.Conn
	writeMu  sync.Mutex
	nextID   atomic.Int64
	mu       sync.Mutex
	pending  map[int]chan Message
	handlers map[string][]EventHandler

	closeOnce sync.Once
	closed    chan struct{}
	readErr   atomic.Pointer[error]
}

// Dial opens a WebSocket connection to wsURL and starts the read loop.
func Dial(ctx context.Context, wsURL string) (*Client, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout:  10 * time.Second,
		EnableCompression: false,
	}
	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return nil, err
	}
	c := &Client{
		conn:     conn,
		pending:  map[int]chan Message{},
		handlers: map[string][]EventHandler{},
		closed:   make(chan struct{}),
	}
	go c.readLoop()
	return c, nil
}

// DialFirstPage finds the index-th page target and dials it.
func DialFirstPage(ctx context.Context, host string, port, index int) (*Client, *Target, error) {
	targets, err := ListTargets(ctx, host, port)
	if err != nil {
		return nil, nil, err
	}
	pages := make([]Target, 0, len(targets))
	for _, t := range targets {
		if t.Type == "page" {
			pages = append(pages, t)
		}
	}
	if len(pages) == 0 {
		return nil, nil, errors.New("no page targets available")
	}
	if index < 0 || index >= len(pages) {
		index = 0
	}
	tgt := pages[index]
	cl, err := Dial(ctx, tgt.WebSocketDebuggerURL)
	return cl, &tgt, err
}

func (c *Client) readLoop() {
	defer close(c.closed)
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			c.readErr.Store(&err)
			c.failPending(err)
			return
		}
		var msg Message
		if jerr := json.Unmarshal(raw, &msg); jerr != nil {
			continue
		}
		switch {
		case msg.ID != 0:
			c.mu.Lock()
			ch, ok := c.pending[msg.ID]
			delete(c.pending, msg.ID)
			c.mu.Unlock()
			if ok {
				ch <- msg
				close(ch)
			}
		case msg.Method != "":
			c.mu.Lock()
			handlers := append([]EventHandler(nil), c.handlers[msg.Method]...)
			c.mu.Unlock()
			for _, h := range handlers {
				h(msg.Params)
			}
		}
	}
}

func (c *Client) failPending(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, ch := range c.pending {
		ch <- Message{ID: id, Error: &RPCError{Code: -1, Message: err.Error()}}
		close(ch)
		delete(c.pending, id)
	}
}

// Send issues a CDP method call and waits for the matching response.
func (c *Client) Send(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := int(c.nextID.Add(1))
	frame := Message{ID: id, Method: method}
	if params != nil {
		raw, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		frame.Params = raw
	}
	data, err := json.Marshal(frame)
	if err != nil {
		return nil, err
	}

	ch := make(chan Message, 1)
	c.mu.Lock()
	c.pending[id] = ch
	c.mu.Unlock()

	c.writeMu.Lock()
	werr := c.conn.WriteMessage(websocket.TextMessage, data)
	c.writeMu.Unlock()
	if werr != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, werr
	}

	select {
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, ctx.Err()
	case <-c.closed:
		if p := c.readErr.Load(); p != nil {
			return nil, *p
		}
		return nil, errors.New("cdp: connection closed")
	case msg := <-ch:
		if msg.Error != nil {
			return nil, msg.Error
		}
		return msg.Result, nil
	}
}

// On registers an event handler for the given CDP method
// (e.g. "Network.requestWillBeSent").
func (c *Client) On(method string, h EventHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers[method] = append(c.handlers[method], h)
}

// Close terminates the connection. Safe to call multiple times.
func (c *Client) Close() error {
	var err error
	c.closeOnce.Do(func() {
		err = c.conn.Close()
	})
	return err
}

// Done returns a channel closed when the read loop terminates.
func (c *Client) Done() <-chan struct{} { return c.closed }
