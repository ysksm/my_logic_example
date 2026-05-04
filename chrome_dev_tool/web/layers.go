package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

// layerCollector wires LayerTree.* events into the existing event sink.
// Event handlers stay registered for the lifetime of the CDP client; an
// `active` flag silences them when the user has not enabled layer
// observation. Tree updates are coalesced to one emit per ~150ms so a
// scroll-driven cascade of changes doesn't flood /ws. The latest tree is
// also cached so highlight requests can look up the rect/backendNode.
type layerCollector struct {
	mu     sync.Mutex
	active bool
	wired  bool
	sink   func(events.Event)

	pmu          sync.Mutex
	pendingTree  events.LayerTree
	pendingTimer *time.Timer

	treeMu sync.Mutex
	tree   events.LayerTree
}

func (l *layerCollector) wire(cl *cdp.Client, sink func(events.Event)) {
	if cl == nil {
		return
	}
	l.mu.Lock()
	l.sink = sink
	l.wired = true
	l.mu.Unlock()

	cl.On("LayerTree.layerTreeDidChange", func(p json.RawMessage) {
		l.mu.Lock()
		active := l.active
		l.mu.Unlock()
		if !active {
			return
		}
		var wrap struct {
			Layers []rawLayer `json:"layers"`
		}
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		layers := make([]events.Layer, 0, len(wrap.Layers))
		for _, r := range wrap.Layers {
			layers = append(layers, r.toEvent())
		}
		tree := events.LayerTree{Layers: layers}
		l.treeMu.Lock()
		l.tree = tree
		l.treeMu.Unlock()
		l.coalesceEmit(tree)
	})

	cl.On("LayerTree.layerPainted", func(p json.RawMessage) {
		l.mu.Lock()
		active := l.active
		sk := l.sink
		l.mu.Unlock()
		if !active || sk == nil {
			return
		}
		var wrap struct {
			LayerID string `json:"layerId"`
			Clip    struct {
				X      float64 `json:"x"`
				Y      float64 `json:"y"`
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			} `json:"clip"`
		}
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		sk(events.New(events.KindLayersPainted, events.LayerPainted{
			LayerID: wrap.LayerID,
			X:       wrap.Clip.X, Y: wrap.Clip.Y,
			Width: wrap.Clip.Width, Height: wrap.Clip.Height,
		}))
	})
}

func (l *layerCollector) start(ctx context.Context, cl *cdp.Client) error {
	if cl == nil {
		return errors.New("not attached")
	}
	l.mu.Lock()
	if l.active {
		l.mu.Unlock()
		return nil
	}
	if !l.wired {
		l.mu.Unlock()
		return errors.New("layer collector not wired")
	}
	l.active = true
	l.mu.Unlock()
	if _, err := cl.Send(ctx, "LayerTree.enable", nil); err != nil {
		l.mu.Lock()
		l.active = false
		l.mu.Unlock()
		return fmt.Errorf("LayerTree.enable: %w", err)
	}
	return nil
}

func (l *layerCollector) stop(ctx context.Context, cl *cdp.Client) error {
	l.mu.Lock()
	wasActive := l.active
	l.active = false
	l.mu.Unlock()
	l.treeMu.Lock()
	l.tree = events.LayerTree{}
	l.treeMu.Unlock()
	if !wasActive || cl == nil {
		return nil
	}
	// Clear any leftover highlight from the browser viewport.
	_, _ = cl.Send(ctx, "Overlay.hideHighlight", nil)
	_, err := cl.Send(ctx, "LayerTree.disable", nil)
	return err
}

func (l *layerCollector) findLayer(id string) (events.Layer, bool) {
	l.treeMu.Lock()
	defer l.treeMu.Unlock()
	for _, lyr := range l.tree.Layers {
		if lyr.LayerID == id {
			return lyr, true
		}
	}
	return events.Layer{}, false
}

// highlightColor is a translucent blue matching the rest of the UI.
var highlightColor = map[string]any{"r": 88, "g": 166, "b": 255, "a": 0.4}
var highlightOutline = map[string]any{"r": 88, "g": 166, "b": 255, "a": 0.95}

// highlight asks the browser to overlay the given layer. Empty id clears.
// Prefers Overlay.highlightNode (with the layer's backendNodeId) so the
// browser draws a "real" inspector-like overlay; falls back to a plain
// rect when no DOM node is associated.
func (l *layerCollector) highlight(ctx context.Context, cl *cdp.Client, layerID string) error {
	if cl == nil {
		return errors.New("not attached")
	}
	// Overlay.* requires DOM.enable; the latter is idempotent.
	if _, err := cl.Send(ctx, "DOM.enable", nil); err != nil {
		return fmt.Errorf("DOM.enable: %w", err)
	}
	if _, err := cl.Send(ctx, "Overlay.enable", nil); err != nil {
		return fmt.Errorf("Overlay.enable: %w", err)
	}
	if layerID == "" {
		if _, err := cl.Send(ctx, "Overlay.hideHighlight", nil); err != nil {
			return fmt.Errorf("Overlay.hideHighlight: %w", err)
		}
		return nil
	}
	lyr, ok := l.findLayer(layerID)
	if !ok {
		return fmt.Errorf("layer %s not in latest tree", layerID)
	}
	if lyr.BackendNodeID > 0 {
		params := map[string]any{
			"backendNodeId": lyr.BackendNodeID,
			"highlightConfig": map[string]any{
				"showInfo":     true,
				"contentColor": highlightColor,
				"paddingColor": map[string]any{"r": 88, "g": 166, "b": 255, "a": 0.2},
				"borderColor":  highlightOutline,
				"marginColor":  map[string]any{"r": 88, "g": 166, "b": 255, "a": 0.1},
			},
		}
		if _, err := cl.Send(ctx, "Overlay.highlightNode", params); err != nil {
			return fmt.Errorf("Overlay.highlightNode: %w", err)
		}
		return nil
	}
	// Fall back to a plain rect when no backing DOM node (e.g. scrolling
	// containers, reflection layers).
	if lyr.Width <= 0 || lyr.Height <= 0 {
		return fmt.Errorf("layer %s has no visible bounds", layerID)
	}
	params := map[string]any{
		"x":            int(lyr.OffsetX),
		"y":            int(lyr.OffsetY),
		"width":        int(lyr.Width),
		"height":       int(lyr.Height),
		"color":        highlightColor,
		"outlineColor": highlightOutline,
	}
	if _, err := cl.Send(ctx, "Overlay.highlightRect", params); err != nil {
		return fmt.Errorf("Overlay.highlightRect: %w", err)
	}
	return nil
}

func (l *layerCollector) compositingReasons(ctx context.Context, cl *cdp.Client, layerID string) ([]string, error) {
	if cl == nil {
		return nil, errors.New("not attached")
	}
	raw, err := cl.Send(ctx, "LayerTree.compositingReasons", map[string]any{"layerId": layerID})
	if err != nil {
		return nil, err
	}
	var wrap struct {
		CompositingReasons   []string `json:"compositingReasons"`
		CompositingReasonIDs []string `json:"compositingReasonIds"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return nil, err
	}
	if len(wrap.CompositingReasons) > 0 {
		return wrap.CompositingReasons, nil
	}
	return wrap.CompositingReasonIDs, nil
}

func (l *layerCollector) coalesceEmit(tree events.LayerTree) {
	l.pmu.Lock()
	l.pendingTree = tree
	if l.pendingTimer != nil {
		l.pmu.Unlock()
		return
	}
	l.pendingTimer = time.AfterFunc(150*time.Millisecond, func() {
		l.pmu.Lock()
		out := l.pendingTree
		l.pendingTimer = nil
		l.pmu.Unlock()
		l.mu.Lock()
		active := l.active
		sk := l.sink
		l.mu.Unlock()
		if !active || sk == nil {
			return
		}
		sk(events.New(events.KindLayersTree, out))
	})
	l.pmu.Unlock()
}

// rawLayer matches the JSON CDP returns for LayerTree.Layer; we project
// only the subset we surface in the UI.
type rawLayer struct {
	LayerID       string    `json:"layerId"`
	ParentLayerID string    `json:"parentLayerId,omitempty"`
	BackendNodeID int       `json:"backendNodeId,omitempty"`
	OffsetX       float64   `json:"offsetX"`
	OffsetY       float64   `json:"offsetY"`
	Width         float64   `json:"width"`
	Height        float64   `json:"height"`
	PaintCount    int       `json:"paintCount,omitempty"`
	DrawsContent  bool      `json:"drawsContent"`
	Invisible     bool      `json:"invisible,omitempty"`
	Transform     []float64 `json:"transform,omitempty"`
	ScrollRects   []any     `json:"scrollRects,omitempty"`
}

func (r rawLayer) toEvent() events.Layer {
	return events.Layer{
		LayerID:         r.LayerID,
		ParentLayerID:   r.ParentLayerID,
		BackendNodeID:   r.BackendNodeID,
		OffsetX:         r.OffsetX,
		OffsetY:         r.OffsetY,
		Width:           r.Width,
		Height:          r.Height,
		PaintCount:      r.PaintCount,
		DrawsContent:    r.DrawsContent,
		Invisible:       r.Invisible,
		Transform:       r.Transform,
		ScrollRectCount: len(r.ScrollRects),
	}
}
