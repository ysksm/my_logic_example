package collectors

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
)

// Rod is a Collector backed by github.com/go-rod/rod.
type Rod struct {
	opts    Options
	browser *rod.Browser
	page    *rod.Page
	cancel  context.CancelFunc
}

func NewRod(opts Options) *Rod { return &Rod{opts: opts} }

func (r *Rod) Name() string { return "rod" }

func (r *Rod) Start(parent context.Context, sink Sink) error {
	endpoint := fmt.Sprintf("http://%s:%d", r.opts.CDPHost, r.opts.CDPPort)
	wsURL, err := launcher.ResolveURL(endpoint)
	if err != nil {
		return fmt.Errorf("rod resolve %s: %w", endpoint, err)
	}

	ctx, cancel := context.WithCancel(parent)
	r.cancel = cancel

	r.browser = rod.New().Context(ctx).ControlURL(wsURL)
	if err := r.browser.Connect(); err != nil {
		return fmt.Errorf("rod connect: %w", err)
	}

	pages, err := r.browser.Pages()
	if err != nil {
		return fmt.Errorf("rod pages: %w", err)
	}
	if len(pages) == 0 {
		// Some launches (notably rod's own launcher with no startup URL)
		// give us a browser with zero page tabs. Create one so we have
		// something to attach to.
		p, err := r.browser.Page(proto.TargetCreateTarget{URL: "about:blank"})
		if err != nil {
			return fmt.Errorf("rod create page: %w", err)
		}
		r.page = p
	} else {
		idx := r.opts.TargetIndex
		if idx < 0 || idx >= len(pages) {
			idx = 0
		}
		r.page = pages[idx]
	}
	sink.Emit(events.New(events.KindMeta, r.Name(), events.Meta{Message: "attached"}))

	// Enable required domains.
	if r.opts.EnableNetwork {
		if err := (proto.NetworkEnable{}).Call(r.page); err != nil {
			return fmt.Errorf("Network.enable: %w", err)
		}
	}
	if r.opts.EnableConsole {
		if err := (proto.RuntimeEnable{}).Call(r.page); err != nil {
			return fmt.Errorf("Runtime.enable: %w", err)
		}
		if err := (proto.LogEnable{}).Call(r.page); err != nil {
			return fmt.Errorf("Log.enable: %w", err)
		}
	}
	if r.opts.EnableLifecycle {
		if err := (proto.PageEnable{}).Call(r.page); err != nil {
			return fmt.Errorf("Page.enable: %w", err)
		}
		_ = proto.PageSetLifecycleEventsEnabled{Enabled: true}.Call(r.page)
	}
	if r.opts.EnablePerformance || r.opts.EnablePerfMonitor {
		domain := proto.PerformanceEnableTimeDomainTimeTicks
		if err := (proto.PerformanceEnable{TimeDomain: domain}).Call(r.page); err != nil {
			return fmt.Errorf("Performance.enable: %w", err)
		}
	}

	// Stream events from the rod browser channel and dispatch by method.
	go r.dispatch(ctx, sink)

	if r.opts.NavigateURL != "" {
		go func() {
			_ = r.page.Navigate(r.opts.NavigateURL)
		}()
	}
	return nil
}

func (r *Rod) dispatch(ctx context.Context, sink Sink) {
	ch := r.browser.Event()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			switch msg.Method {
			case (proto.NetworkRequestWillBeSent{}).ProtoEvent():
				var e proto.NetworkRequestWillBeSent
				if msg.Load(&e) {
					sink.Emit(events.New(events.KindNetworkRequest, r.Name(), events.NetworkRequest{
						RequestID: string(e.RequestID), URL: e.Request.URL,
						Method: e.Request.Method, Type: string(e.Type),
						Headers: headerMap(e.Request.Headers),
					}))
				}
			case (proto.NetworkResponseReceived{}).ProtoEvent():
				var e proto.NetworkResponseReceived
				if msg.Load(&e) {
					sink.Emit(events.New(events.KindNetworkResponse, r.Name(), events.NetworkResponse{
						RequestID: string(e.RequestID), URL: e.Response.URL,
						Status: e.Response.Status, StatusText: e.Response.StatusText,
						MimeType: e.Response.MIMEType, Headers: headerMap(e.Response.Headers),
						FromCache: e.Response.FromDiskCache, Protocol: e.Response.Protocol,
					}))
				}
			case (proto.NetworkLoadingFinished{}).ProtoEvent():
				var e proto.NetworkLoadingFinished
				if msg.Load(&e) {
					sink.Emit(events.New(events.KindNetworkFinished, r.Name(), events.NetworkFinished{
						RequestID: string(e.RequestID), EncodedDataLength: e.EncodedDataLength,
					}))
				}
			case (proto.NetworkLoadingFailed{}).ProtoEvent():
				var e proto.NetworkLoadingFailed
				if msg.Load(&e) {
					sink.Emit(events.New(events.KindNetworkFailed, r.Name(), events.NetworkFailed{
						RequestID: string(e.RequestID), ErrorText: e.ErrorText, Canceled: e.Canceled,
					}))
				}
			case (proto.RuntimeConsoleAPICalled{}).ProtoEvent():
				var e proto.RuntimeConsoleAPICalled
				if msg.Load(&e) {
					parts := make([]string, 0, len(e.Args))
					for _, a := range e.Args {
						if v := a.Value.String(); v != "" {
							parts = append(parts, v)
						} else {
							parts = append(parts, a.Description)
						}
					}
					sink.Emit(events.New(events.KindConsole, r.Name(), events.ConsoleEntry{
						Level: string(e.Type), Text: strings.Join(parts, " "),
					}))
				}
			case (proto.RuntimeExceptionThrown{}).ProtoEvent():
				var e proto.RuntimeExceptionThrown
				if msg.Load(&e) {
					text := e.ExceptionDetails.Text
					if e.ExceptionDetails.Exception != nil && e.ExceptionDetails.Exception.Description != "" {
						text = e.ExceptionDetails.Exception.Description
					}
					sink.Emit(events.New(events.KindException, r.Name(), events.ConsoleEntry{
						Level: "error", Text: text,
						URL: e.ExceptionDetails.URL, Line: e.ExceptionDetails.LineNumber,
					}))
				}
			case (proto.LogEntryAdded{}).ProtoEvent():
				var e proto.LogEntryAdded
				if msg.Load(&e) {
					sink.Emit(events.New(events.KindLog, r.Name(), events.ConsoleEntry{
						Level: string(e.Entry.Level), Text: e.Entry.Text, URL: e.Entry.URL,
					}))
				}
			case (proto.PerformanceMetrics{}).ProtoEvent():
				var e proto.PerformanceMetrics
				if msg.Load(&e) {
					m := map[string]float64{}
					for _, kv := range e.Metrics {
						m[kv.Name] = kv.Value
					}
					sink.Emit(events.New(events.KindPerfMonitor, r.Name(), events.PerfMonitorSample{
						Title: e.Title, Metrics: m,
					}))
				}
			case (proto.PageLifecycleEvent{}).ProtoEvent():
				var e proto.PageLifecycleEvent
				if msg.Load(&e) {
					sink.Emit(events.New(events.KindLifecycle, r.Name(), events.Lifecycle{
						Name: string(e.Name), FrameID: string(e.FrameID), Timestamp: float64(e.Timestamp),
					}))
				}
			case (proto.PageFrameNavigated{}).ProtoEvent():
				var e proto.PageFrameNavigated
				if msg.Load(&e) {
					if e.Frame != nil {
						sink.Emit(events.New(events.KindNavigated, r.Name(), events.Navigated{URL: e.Frame.URL}))
					}
				}
			}
		}
	}
}

func (r *Rod) SnapshotMetrics(ctx context.Context) (events.PerfMetrics, error) {
	if r.page == nil {
		return events.PerfMetrics{}, errors.New("not started")
	}
	res, err := (proto.PerformanceGetMetrics{}).Call(r.page)
	if err != nil {
		return events.PerfMetrics{}, err
	}
	out := events.PerfMetrics{Metrics: map[string]float64{}}
	for _, kv := range res.Metrics {
		out.Metrics[kv.Name] = kv.Value
	}
	return out, nil
}

func (r *Rod) Stop() error {
	if r.cancel != nil {
		r.cancel()
	}
	// Don't close the remote browser — when we attached via ControlURL we
	// don't own its lifecycle. Cancelling the context is enough to detach.
	return nil
}

func headerMap(h proto.NetworkHeaders) map[string]string {
	out := map[string]string{}
	for k, v := range h {
		out[k] = v.String()
	}
	return out
}
