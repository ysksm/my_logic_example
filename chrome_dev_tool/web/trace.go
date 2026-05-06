package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
)

// Default category set roughly matching Chrome DevTools' Performance panel.
// Users can override via TraceStartParams.Categories.
var defaultTraceCategories = []string{
	"-*",
	"devtools.timeline",
	"disabled-by-default-devtools.timeline",
	"disabled-by-default-devtools.timeline.frame",
	"disabled-by-default-devtools.timeline.stack",
	"disabled-by-default-devtools.screenshot",
	"disabled-by-default-v8.cpu_profiler",
	"toplevel",
	"blink.console",
	"blink.user_timing",
	"latencyInfo",
}

// TraceStartParams is the JSON body of POST /api/trace/start.
type TraceStartParams struct {
	// Categories is the explicit category list (each entry is a CDP
	// category, e.g. "devtools.timeline" or "-*"). Empty falls back to
	// defaultTraceCategories.
	Categories []string `json:"categories,omitempty"`
}

// TraceFile is the JSON returned by POST /api/trace/stop. The shape is the
// one Chrome DevTools' "Load profile" expects.
type TraceFile struct {
	TraceEvents []json.RawMessage `json:"traceEvents"`
	Metadata    map[string]any    `json:"metadata,omitempty"`
}

// tracer accumulates Tracing.dataCollected chunks for one recording session.
type tracer struct {
	mu       sync.Mutex
	active   bool
	events   []json.RawMessage
	complete chan struct{}
	wired    bool
}

// wire registers the persistent CDP event handlers. Safe to call multiple
// times; subsequent calls re-wire onto the new Client (handlers are not
// removable on the previous one, but we drop their output via t.active).
func (t *tracer) wire(cl *cdp.Client) {
	if cl == nil {
		return
	}
	t.mu.Lock()
	t.wired = true
	t.mu.Unlock()
	cl.On("Tracing.dataCollected", func(p json.RawMessage) {
		var wrap struct {
			Value []json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		t.mu.Lock()
		defer t.mu.Unlock()
		if !t.active {
			return
		}
		t.events = append(t.events, wrap.Value...)
	})
	cl.On("Tracing.tracingComplete", func(p json.RawMessage) {
		t.mu.Lock()
		defer t.mu.Unlock()
		if t.complete != nil {
			close(t.complete)
			t.complete = nil
		}
	})
}

// start kicks off Tracing.start. It must be called after wire().
func (t *tracer) start(ctx context.Context, cl *cdp.Client, p TraceStartParams) error {
	if cl == nil {
		return errors.New("not attached")
	}
	t.mu.Lock()
	if t.active {
		t.mu.Unlock()
		return errors.New("tracing already in progress")
	}
	if !t.wired {
		t.mu.Unlock()
		return errors.New("tracer not wired (was the collector started?)")
	}
	t.events = nil
	t.complete = make(chan struct{})
	t.active = true
	t.mu.Unlock()

	cats := p.Categories
	if len(cats) == 0 {
		cats = defaultTraceCategories
	}
	params := map[string]any{
		"categories":   strings.Join(cats, ","),
		"transferMode": "ReportEvents",
	}
	if _, err := cl.Send(ctx, "Tracing.start", params); err != nil {
		t.mu.Lock()
		t.active = false
		if t.complete != nil {
			close(t.complete)
			t.complete = nil
		}
		t.mu.Unlock()
		return fmt.Errorf("Tracing.start: %w", err)
	}
	return nil
}

// stop ends the recording and waits for tracingComplete, then returns the
// accumulated events as a Chrome-DevTools-loadable file.
func (t *tracer) stop(ctx context.Context, cl *cdp.Client) (TraceFile, error) {
	if cl == nil {
		return TraceFile{}, errors.New("not attached")
	}
	t.mu.Lock()
	if !t.active {
		t.mu.Unlock()
		return TraceFile{}, errors.New("no tracing in progress")
	}
	complete := t.complete
	t.mu.Unlock()

	if _, err := cl.Send(ctx, "Tracing.end", nil); err != nil {
		// We may not get a tracingComplete; still mark inactive and surface err.
		t.mu.Lock()
		t.active = false
		t.events = nil
		t.complete = nil
		t.mu.Unlock()
		return TraceFile{}, fmt.Errorf("Tracing.end: %w", err)
	}

	select {
	case <-complete:
	case <-ctx.Done():
		t.mu.Lock()
		t.active = false
		t.events = nil
		t.complete = nil
		t.mu.Unlock()
		return TraceFile{}, ctx.Err()
	case <-time.After(60 * time.Second):
		t.mu.Lock()
		t.active = false
		t.events = nil
		t.complete = nil
		t.mu.Unlock()
		return TraceFile{}, errors.New("timed out waiting for Tracing.tracingComplete")
	}

	t.mu.Lock()
	events := t.events
	t.events = nil
	t.active = false
	t.mu.Unlock()

	return TraceFile{
		TraceEvents: events,
		Metadata: map[string]any{
			"source":     "chrome_dev_tool",
			"recordedAt": time.Now().UTC().Format(time.RFC3339),
		},
	}, nil
}

// IsActive reports whether a recording is in flight.
func (t *tracer) IsActive() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.active
}
