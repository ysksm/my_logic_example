// Package collectors defines the Collector interface — the contract every
// implementation (chromedp, rod, raw WS) must satisfy. A Collector connects
// to Chrome over CDP, enables the relevant domains, and pushes Events to a
// sink until Stop is called.
package collectors

import (
	"context"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
)

// Sink receives events from a Collector. Implementations: recorder.Recorder,
// the WS hub, the CLI tee printer. Sinks must be safe for concurrent calls.
type Sink interface {
	Emit(events.Event)
}

// SinkFunc adapts a plain function to the Sink interface.
type SinkFunc func(events.Event)

func (f SinkFunc) Emit(e events.Event) { f(e) }

// FanOut multiplexes events to all sinks.
type FanOut []Sink

func (f FanOut) Emit(e events.Event) {
	for _, s := range f {
		s.Emit(e)
	}
}

// Options controls what a Collector turns on.
type Options struct {
	// CDPHost is the host running Chrome with --remote-debugging-port.
	CDPHost string
	// CDPPort is the remote debugging port.
	CDPPort int
	// TargetIndex picks one of the page targets returned by /json.
	TargetIndex int
	// NavigateURL, if set, is loaded after the collector attaches.
	NavigateURL string

	// Domains to enable.
	EnableNetwork     bool
	EnableConsole     bool
	EnablePerformance bool
	EnablePerfMonitor bool // Performance.enable + Performance.metrics events
	EnableLifecycle   bool

	// PerfMonitorIntervalMs throttles Performance.enable timeDomain sampling.
	// 0 = use default.
	PerfMonitorIntervalMs int
}

// Default returns a sensible default Options for "watch everything on
// localhost:9222".
func Default() Options {
	return Options{
		CDPHost:           "localhost",
		CDPPort:           9222,
		EnableNetwork:     true,
		EnableConsole:     true,
		EnablePerformance: true,
		EnablePerfMonitor: true,
		EnableLifecycle:   true,
	}
}

// Collector is the contract every implementation satisfies.
type Collector interface {
	// Name returns a stable identifier ("chromedp" | "rod" | "raw").
	Name() string
	// Start attaches to Chrome, enables domains, and begins streaming events
	// to sink. It returns once attachment is complete (events flow async).
	Start(ctx context.Context, sink Sink) error
	// SnapshotMetrics issues Performance.getMetrics on demand.
	SnapshotMetrics(ctx context.Context) (events.PerfMetrics, error)
	// Stop disconnects from Chrome.
	Stop() error
}
