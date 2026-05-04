// Package events defines the unified event model emitted by the collector.
// UI / CLI / future recorder all consume the same Event so the wire format
// stays stable regardless of the CDP-side detail.
package events

import (
	"encoding/json"
	"time"
)

type Kind string

const (
	KindNetworkRequest  Kind = "network.request"
	KindNetworkResponse Kind = "network.response"
	KindNetworkFinished Kind = "network.finished"
	KindNetworkFailed   Kind = "network.failed"

	KindConsole   Kind = "console"
	KindLog       Kind = "log"
	KindException Kind = "exception"

	KindPerfMonitor Kind = "perf.monitor"
	KindPerfMetrics Kind = "perf.metrics"

	KindLayersTree    Kind = "layers.tree"
	KindLayersPainted Kind = "layers.painted"

	KindMeta Kind = "meta"
)

type Event struct {
	Time   time.Time       `json:"time"`
	Kind   Kind            `json:"kind"`
	Target string          `json:"target,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
}

func New(kind Kind, data any) Event {
	raw, _ := json.Marshal(data)
	return Event{
		Time: time.Now().UTC(),
		Kind: kind,
		Data: raw,
	}
}

type NetworkRequest struct {
	RequestID string            `json:"requestId"`
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Type      string            `json:"resourceType,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
}

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

type NetworkFinished struct {
	RequestID         string  `json:"requestId"`
	EncodedDataLength float64 `json:"encodedDataLength"`
}

type NetworkFailed struct {
	RequestID string `json:"requestId"`
	ErrorText string `json:"errorText"`
	Canceled  bool   `json:"canceled,omitempty"`
}

type ConsoleEntry struct {
	Level string `json:"level"`
	Text  string `json:"text"`
	URL   string `json:"url,omitempty"`
	Line  int    `json:"line,omitempty"`
}

type PerfSample struct {
	Title   string             `json:"title"`
	Metrics map[string]float64 `json:"metrics"`
}

type Meta struct {
	Message string         `json:"message"`
	Extra   map[string]any `json:"extra,omitempty"`
}

// Layer mirrors LayerTree.Layer (subset CDP exposes per layer).
type Layer struct {
	LayerID         string    `json:"layerId"`
	ParentLayerID   string    `json:"parentLayerId,omitempty"`
	BackendNodeID   int       `json:"backendNodeId,omitempty"`
	OffsetX         float64   `json:"offsetX"`
	OffsetY         float64   `json:"offsetY"`
	Width           float64   `json:"width"`
	Height          float64   `json:"height"`
	PaintCount      int       `json:"paintCount,omitempty"`
	DrawsContent    bool      `json:"drawsContent"`
	Invisible       bool      `json:"invisible,omitempty"`
	Transform       []float64 `json:"transform,omitempty"`
	ScrollRectCount int       `json:"scrollRectCount,omitempty"`
}

// LayerTree is the payload of KindLayersTree (snapshot of the compositing tree).
type LayerTree struct {
	Layers []Layer `json:"layers"`
}

// LayerPainted is the payload of KindLayersPainted (one rect repainted).
type LayerPainted struct {
	LayerID string  `json:"layerId"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Width   float64 `json:"width"`
	Height  float64 `json:"height"`
}
