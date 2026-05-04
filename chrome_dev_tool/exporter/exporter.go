package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/collector"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

// Exporter wires a single CDP attach to a Prometheus Registry. All metric
// updates flow through Emit, called from the collector's CDP read loop.
type Exporter struct {
	reg     *Registry
	version string

	// Build / target gauges
	buildInfo  *Gauge
	targetInfo *Gauge
	attached   *Gauge

	// Performance gauges (instantaneous)
	jsHeapUsed       *Gauge
	jsHeapTotal      *Gauge
	domNodes         *Gauge
	jsEventListeners *Gauge
	documents        *Gauge
	frames           *Gauge

	// Performance counters (cumulative — Chrome reports running totals)
	layoutCountTotal           *Counter
	recalcStyleCountTotal      *Counter
	layoutDurationSeconds      *Counter
	recalcStyleDurationSeconds *Counter
	scriptDurationSeconds      *Counter
	taskDurationSeconds        *Counter

	// Network counters (we increment per-event)
	netRequests *Counter
	netResponses *Counter
	netFailed    *Counter
	netBytes     *Counter

	// Console / Log counters
	consoleMessages *Counter
	exceptionsTotal *Counter

	// Lifecycle
	col   *collector.Collector
	mu    sync.Mutex
	state struct {
		host      string
		port      int
		targetURL string
	}
}

func NewExporter(reg *Registry, version string) *Exporter {
	e := &Exporter{reg: reg, version: version}
	e.buildInfo = reg.NewGauge("chrome_devtools_exporter_build_info",
		"Constant 1 with the exporter version label.")
	e.targetInfo = reg.NewGauge("chrome_devtools_target_info",
		"Constant 1 with labels describing the attached target. Empty when detached.")
	e.attached = reg.NewGauge("chrome_devtools_target_attached",
		"1 when a CDP target is attached, 0 otherwise.")

	e.jsHeapUsed = reg.NewGauge("chrome_devtools_jsheap_used_bytes",
		"V8 JS heap used size in bytes (Performance.JSHeapUsedSize).")
	e.jsHeapTotal = reg.NewGauge("chrome_devtools_jsheap_total_bytes",
		"V8 JS heap total size in bytes (Performance.JSHeapTotalSize).")
	e.domNodes = reg.NewGauge("chrome_devtools_dom_nodes",
		"Live DOM nodes count (Performance.Nodes).")
	e.jsEventListeners = reg.NewGauge("chrome_devtools_js_event_listeners",
		"Live JS event listener count (Performance.JSEventListeners).")
	e.documents = reg.NewGauge("chrome_devtools_documents",
		"Live Document count (Performance.Documents).")
	e.frames = reg.NewGauge("chrome_devtools_document_frames",
		"Live frame count (Performance.Frames).")

	e.layoutCountTotal = reg.NewCounter("chrome_devtools_layout_count_total",
		"Cumulative layout passes (Performance.LayoutCount).")
	e.recalcStyleCountTotal = reg.NewCounter("chrome_devtools_recalc_style_count_total",
		"Cumulative style recalculations (Performance.RecalcStyleCount).")
	e.layoutDurationSeconds = reg.NewCounter("chrome_devtools_layout_duration_seconds_total",
		"Cumulative layout duration (Performance.LayoutDuration).")
	e.recalcStyleDurationSeconds = reg.NewCounter("chrome_devtools_recalc_style_duration_seconds_total",
		"Cumulative style recalc duration (Performance.RecalcStyleDuration).")
	e.scriptDurationSeconds = reg.NewCounter("chrome_devtools_script_duration_seconds_total",
		"Cumulative JS execution time (Performance.ScriptDuration).")
	e.taskDurationSeconds = reg.NewCounter("chrome_devtools_task_duration_seconds_total",
		"Cumulative renderer task time, ~ CPU usage (Performance.TaskDuration).")

	e.netRequests = reg.NewCounter("chrome_devtools_network_requests_total",
		"Network requests started since attach.")
	e.netResponses = reg.NewCounter("chrome_devtools_network_responses_total",
		"Network responses received since attach, bucketed by status_class.")
	e.netFailed = reg.NewCounter("chrome_devtools_network_failed_total",
		"Network requests that failed since attach.")
	e.netBytes = reg.NewCounter("chrome_devtools_network_bytes_total",
		"Total encoded bytes received over the network since attach.")

	e.consoleMessages = reg.NewCounter("chrome_devtools_console_messages_total",
		"Console / Log messages observed since attach, bucketed by level.")
	e.exceptionsTotal = reg.NewCounter("chrome_devtools_exceptions_total",
		"Uncaught exceptions observed since attach.")

	e.buildInfo.Set(1, map[string]string{"version": version})
	e.attached.Set(0, nil)
	return e
}

// AttachAndCollect dials the given target and wires the collector. It
// returns once the collector is up; events flow on the sink in the
// background until Stop or context cancellation.
func (e *Exporter) AttachAndCollect(
	ctx context.Context,
	host string,
	port int,
	index int,
	perfInterval time.Duration,
	navigateURL string,
) error {
	c := collector.New(collector.Options{
		Host:          host,
		Port:          port,
		TargetIndex:   index,
		NavigateURL:   navigateURL,
		EnableNetwork: true,
		EnableConsole: true,
		EnablePerf:    true,
		PerfInterval:  perfInterval,
	})
	if err := c.Start(ctx, collector.SinkFunc(e.Emit)); err != nil {
		return err
	}
	e.mu.Lock()
	e.col = c
	e.state.host = host
	e.state.port = port
	if t := c.Target(); t != nil {
		e.state.targetURL = t.URL
	}
	e.mu.Unlock()
	e.attached.Set(1, nil)
	targetURL := ""
	if t := c.Target(); t != nil {
		targetURL = t.URL
	}
	e.targetInfo.Set(1, map[string]string{
		"target_url": targetURL,
		"host":       host,
		"port":       fmt.Sprintf("%d", port),
	})
	return nil
}

func (e *Exporter) Stop() {
	e.mu.Lock()
	c := e.col
	e.col = nil
	e.mu.Unlock()
	if c != nil {
		_ = c.Stop()
	}
	e.attached.Set(0, nil)
	// We leave target_info series in the registry; on next attach the same
	// label tuple is updated in place. That matches what other Prom
	// exporters do for "info" gauges.
}

// CDPClient is exposed so main can ListTargets / ping.
func (e *Exporter) CDPClient() *cdp.Client {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.col == nil {
		return nil
	}
	return e.col.Client()
}

// ─── Sink ───────────────────────────────────────────────────────────────

func (e *Exporter) Emit(ev events.Event) {
	switch ev.Kind {
	case events.KindPerfMonitor:
		var s events.PerfSample
		if err := json.Unmarshal(ev.Data, &s); err != nil {
			return
		}
		e.applyPerfSample(s.Metrics)

	case events.KindNetworkRequest:
		var d events.NetworkRequest
		if err := json.Unmarshal(ev.Data, &d); err != nil {
			return
		}
		e.netRequests.Add(1, map[string]string{
			"method": d.Method,
			"type":   d.Type,
		})

	case events.KindNetworkResponse:
		var d events.NetworkResponse
		if err := json.Unmarshal(ev.Data, &d); err != nil {
			return
		}
		e.netResponses.Add(1, map[string]string{
			"status_class": statusClass(d.Status),
			"protocol":     d.Protocol,
		})

	case events.KindNetworkFinished:
		var d events.NetworkFinished
		if err := json.Unmarshal(ev.Data, &d); err != nil {
			return
		}
		if d.EncodedDataLength > 0 {
			e.netBytes.Add(d.EncodedDataLength, nil)
		}

	case events.KindNetworkFailed:
		e.netFailed.Add(1, nil)

	case events.KindConsole:
		var d events.ConsoleEntry
		if err := json.Unmarshal(ev.Data, &d); err != nil {
			return
		}
		e.consoleMessages.Add(1, map[string]string{
			"level":  bucketLevel(d.Level),
			"source": "console",
		})

	case events.KindLog:
		var d events.ConsoleEntry
		if err := json.Unmarshal(ev.Data, &d); err != nil {
			return
		}
		e.consoleMessages.Add(1, map[string]string{
			"level":  bucketLevel(d.Level),
			"source": "log",
		})

	case events.KindException:
		e.exceptionsTotal.Add(1, nil)
	}
}

func (e *Exporter) applyPerfSample(m map[string]float64) {
	get := func(k string) (float64, bool) { v, ok := m[k]; return v, ok }
	if v, ok := get("JSHeapUsedSize"); ok {
		e.jsHeapUsed.Set(v, nil)
	}
	if v, ok := get("JSHeapTotalSize"); ok {
		e.jsHeapTotal.Set(v, nil)
	}
	if v, ok := get("Nodes"); ok {
		e.domNodes.Set(v, nil)
	}
	if v, ok := get("JSEventListeners"); ok {
		e.jsEventListeners.Set(v, nil)
	}
	if v, ok := get("Documents"); ok {
		e.documents.Set(v, nil)
	}
	if v, ok := get("Frames"); ok {
		e.frames.Set(v, nil)
	}
	// Cumulative counters (Chrome already reports running totals).
	if v, ok := get("LayoutCount"); ok {
		e.layoutCountTotal.SetCumulative(v, nil)
	}
	if v, ok := get("RecalcStyleCount"); ok {
		e.recalcStyleCountTotal.SetCumulative(v, nil)
	}
	if v, ok := get("LayoutDuration"); ok {
		e.layoutDurationSeconds.SetCumulative(v, nil)
	}
	if v, ok := get("RecalcStyleDuration"); ok {
		e.recalcStyleDurationSeconds.SetCumulative(v, nil)
	}
	if v, ok := get("ScriptDuration"); ok {
		e.scriptDurationSeconds.SetCumulative(v, nil)
	}
	if v, ok := get("TaskDuration"); ok {
		e.taskDurationSeconds.SetCumulative(v, nil)
	}
}

func statusClass(s int) string {
	switch {
	case s == 0:
		return "pending"
	case s < 200:
		return "1xx"
	case s < 300:
		return "2xx"
	case s < 400:
		return "3xx"
	case s < 500:
		return "4xx"
	default:
		return "5xx"
	}
}

func bucketLevel(level string) string {
	switch level {
	case "error", "exception", "severe":
		return "error"
	case "warn", "warning":
		return "warning"
	case "info":
		return "info"
	case "debug", "verbose", "trace":
		return "debug"
	default:
		return "log"
	}
}
