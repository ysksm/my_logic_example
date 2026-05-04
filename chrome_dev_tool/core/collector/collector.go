// Package collector subscribes to CDP domains and produces events.Event.
// All CDP traffic flows through core/cdp; this package contains no
// websocket-level details.
package collector

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

// Options configures a Collector run.
type Options struct {
	Host        string
	Port        int
	TargetIndex int
	NavigateURL string

	EnableNetwork bool
	EnableConsole bool
	EnablePerf    bool

	// PerfInterval is the polling cadence for Performance.getMetrics when
	// EnablePerf is true. Zero falls back to 1s.
	PerfInterval time.Duration
}

// Sink receives events emitted by the collector.
type Sink interface {
	Emit(events.Event)
}

// SinkFunc lets a plain function satisfy Sink.
type SinkFunc func(events.Event)

func (f SinkFunc) Emit(e events.Event) { f(e) }

// Collector wires a CDP client to an events sink.
type Collector struct {
	opts   Options
	client *cdp.Client
	target *cdp.Target

	mu      sync.Mutex
	stopped bool
	cancel  context.CancelFunc
}

func New(opts Options) *Collector { return &Collector{opts: opts} }

// Start dials the page target, enables the requested domains and registers
// handlers. It returns once the initial setup is done; events flow on the
// supplied sink in the background until Stop is called.
func (c *Collector) Start(ctx context.Context, sink Sink) error {
	cl, tgt, err := cdp.DialFirstPage(ctx, c.opts.Host, c.opts.Port, c.opts.TargetIndex)
	if err != nil {
		return err
	}
	c.client = cl
	c.target = tgt
	sink.Emit(events.New(events.KindMeta, events.Meta{
		Message: "attached",
		Extra:   map[string]any{"target": tgt.URL, "id": tgt.ID},
	}))

	if _, err := cl.Send(ctx, "Page.enable", nil); err != nil {
		return fmt.Errorf("Page.enable: %w", err)
	}

	if c.opts.EnableNetwork {
		if err := wireNetwork(ctx, cl, sink); err != nil {
			return err
		}
	}
	if c.opts.EnableConsole {
		if err := wireConsole(ctx, cl, sink); err != nil {
			return err
		}
	}
	if c.opts.EnablePerf {
		runCtx, cancel := context.WithCancel(context.Background())
		c.cancel = cancel
		interval := c.opts.PerfInterval
		if interval <= 0 {
			interval = time.Second
		}
		if err := wirePerformance(ctx, runCtx, cl, sink, interval); err != nil {
			cancel()
			return err
		}
	}

	if c.opts.NavigateURL != "" {
		if _, err := cl.Send(ctx, "Page.navigate", map[string]any{"url": c.opts.NavigateURL}); err != nil {
			return fmt.Errorf("Page.navigate: %w", err)
		}
	}
	return nil
}

// SnapshotMetrics calls Performance.getMetrics once.
func (c *Collector) SnapshotMetrics(ctx context.Context) (events.PerfSample, error) {
	if c.client == nil {
		return events.PerfSample{}, errors.New("collector not started")
	}
	return getMetricsOnce(ctx, c.client)
}

// Stop closes the CDP connection. Safe to call multiple times.
func (c *Collector) Stop() error {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return nil
	}
	c.stopped = true
	c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
	}
	if c.client != nil {
		return c.client.Close()
	}
	return nil
}

// Target returns the attached page target (nil before Start).
func (c *Collector) Target() *cdp.Target { return c.target }

// Client returns the underlying CDP client (nil before Start). Exposed so
// the web layer can issue ad-hoc commands (throttling, tracing, …) without
// re-implementing collector lifecycle.
func (c *Collector) Client() *cdp.Client { return c.client }
