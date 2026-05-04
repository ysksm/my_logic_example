// Package events defines the unified event model emitted by every collector.
// chromedp, rod, and the raw WebSocket implementation all funnel into the
// same Event so downstream sinks (recorder, WS hub, CLI printer) can stay
// implementation-agnostic.
package events

import (
	"encoding/json"
	"time"
)

// Kind classifies an Event. Keep these short — they end up in NDJSON files.
type Kind string

const (
	KindNetworkRequest  Kind = "network.request"
	KindNetworkResponse Kind = "network.response"
	KindNetworkFinished Kind = "network.finished"
	KindNetworkFailed   Kind = "network.failed"

	KindConsole Kind = "console"
	KindLog     Kind = "log"
	KindException Kind = "exception"

	KindPerfMetrics Kind = "perf.metrics"
	KindPerfMonitor Kind = "perf.monitor"
	KindLifecycle   Kind = "page.lifecycle"
	KindNavigated   Kind = "page.navigated"

	KindMeta Kind = "meta"
)

// Event is what the UI, recorder, and CLI consume.
type Event struct {
	Time   time.Time       `json:"time"`
	Kind   Kind            `json:"kind"`
	Source string          `json:"source"` // "chromedp" | "rod" | "raw"
	Target string          `json:"target,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// New builds an Event with `data` JSON-encoded.
func New(kind Kind, source string, data any) Event {
	raw, _ := json.Marshal(data)
	return Event{
		Time:   time.Now().UTC(),
		Kind:   kind,
		Source: source,
		Data:   raw,
	}
}

// NetworkRequest is the payload for KindNetworkRequest.
type NetworkRequest struct {
	RequestID string            `json:"requestId"`
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Type      string            `json:"resourceType,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
}

// NetworkResponse is the payload for KindNetworkResponse.
type NetworkResponse struct {
	RequestID  string            `json:"requestId"`
	URL        string            `json:"url"`
	Status     int               `json:"status"`
	StatusText string            `json:"statusText,omitempty"`
	MimeType   string            `json:"mimeType,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	FromCache  bool              `json:"fromCache,omitempty"`
	Protocol   string            `json:"protocol,omitempty"`
}

// NetworkFinished marks loadingFinished.
type NetworkFinished struct {
	RequestID         string  `json:"requestId"`
	EncodedDataLength float64 `json:"encodedDataLength"`
}

// NetworkFailed marks loadingFailed.
type NetworkFailed struct {
	RequestID string `json:"requestId"`
	ErrorText string `json:"errorText"`
	Canceled  bool   `json:"canceled,omitempty"`
}

// ConsoleEntry covers Runtime.consoleAPICalled / Log.entryAdded.
type ConsoleEntry struct {
	Level string `json:"level"`
	Text  string `json:"text"`
	URL   string `json:"url,omitempty"`
	Line  int    `json:"line,omitempty"`
}

// PerfMetrics is the snapshot returned by Performance.getMetrics.
type PerfMetrics struct {
	Metrics map[string]float64 `json:"metrics"`
}

// PerfMonitorSample is one sample from Performance.metrics streamed by
// Chrome's performance monitor (Performance.metrics event).
type PerfMonitorSample struct {
	Title   string             `json:"title"`
	Metrics map[string]float64 `json:"metrics"`
}

// Lifecycle is the payload for KindLifecycle.
type Lifecycle struct {
	Name      string  `json:"name"`
	FrameID   string  `json:"frameId,omitempty"`
	Timestamp float64 `json:"timestamp,omitempty"`
}

// Navigated is the payload for KindNavigated.
type Navigated struct {
	URL string `json:"url"`
}

// Meta is used to mark session/control events.
type Meta struct {
	Message string         `json:"message"`
	Extra   map[string]any `json:"extra,omitempty"`
}
