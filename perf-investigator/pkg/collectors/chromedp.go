package collectors

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/chromedp/cdproto/log"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/performance"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
)

// Chromedp is a Collector backed by github.com/chromedp/chromedp. It attaches
// to an already-running Chrome via the remote allocator.
type Chromedp struct {
	opts       Options
	allocCtx   context.Context
	allocClose context.CancelFunc
	browser    context.Context
	browserCl  context.CancelFunc
	tab        context.Context
	tabCl      context.CancelFunc
}

func NewChromedp(opts Options) *Chromedp { return &Chromedp{opts: opts} }

func (c *Chromedp) Name() string { return "chromedp" }

func (c *Chromedp) Start(ctx context.Context, sink Sink) error {
	wsURL := fmt.Sprintf("ws://%s:%d", c.opts.CDPHost, c.opts.CDPPort)
	c.allocCtx, c.allocClose = chromedp.NewRemoteAllocator(ctx, wsURL, chromedp.NoModifyURL)
	c.browser, c.browserCl = chromedp.NewContext(c.allocCtx)

	// Start the browser context (attaches to remote target).
	if err := chromedp.Run(c.browser); err != nil {
		return fmt.Errorf("chromedp attach: %w", err)
	}
	c.tab, c.tabCl = chromedp.NewContext(c.browser)

	chromedp.ListenTarget(c.tab, func(ev any) {
		switch e := ev.(type) {
		case *network.EventRequestWillBeSent:
			headers := flattenHeaders(e.Request.Headers)
			sink.Emit(events.New(events.KindNetworkRequest, c.Name(), events.NetworkRequest{
				RequestID: string(e.RequestID), URL: e.Request.URL,
				Method: e.Request.Method, Type: e.Type.String(), Headers: headers,
			}))
		case *network.EventResponseReceived:
			sink.Emit(events.New(events.KindNetworkResponse, c.Name(), events.NetworkResponse{
				RequestID: string(e.RequestID), URL: e.Response.URL,
				Status: int(e.Response.Status), StatusText: e.Response.StatusText,
				MimeType: e.Response.MimeType, Headers: flattenHeaders(e.Response.Headers),
				FromCache: e.Response.FromDiskCache, Protocol: e.Response.Protocol,
			}))
		case *network.EventLoadingFinished:
			sink.Emit(events.New(events.KindNetworkFinished, c.Name(), events.NetworkFinished{
				RequestID: string(e.RequestID), EncodedDataLength: e.EncodedDataLength,
			}))
		case *network.EventLoadingFailed:
			sink.Emit(events.New(events.KindNetworkFailed, c.Name(), events.NetworkFailed{
				RequestID: string(e.RequestID), ErrorText: e.ErrorText, Canceled: e.Canceled,
			}))
		case *runtime.EventConsoleAPICalled:
			parts := make([]string, 0, len(e.Args))
			for _, a := range e.Args {
				if len(a.Value) > 0 {
					parts = append(parts, string(a.Value))
				} else {
					parts = append(parts, a.Description)
				}
			}
			sink.Emit(events.New(events.KindConsole, c.Name(), events.ConsoleEntry{
				Level: string(e.Type), Text: strings.Join(parts, " "),
			}))
		case *runtime.EventExceptionThrown:
			text := e.ExceptionDetails.Text
			if e.ExceptionDetails.Exception != nil {
				if d := e.ExceptionDetails.Exception.Description; d != "" {
					text = d
				}
			}
			sink.Emit(events.New(events.KindException, c.Name(), events.ConsoleEntry{
				Level: "error", Text: text,
				URL: e.ExceptionDetails.URL, Line: int(e.ExceptionDetails.LineNumber),
			}))
		case *log.EventEntryAdded:
			sink.Emit(events.New(events.KindLog, c.Name(), events.ConsoleEntry{
				Level: string(e.Entry.Level), Text: e.Entry.Text, URL: e.Entry.URL,
			}))
		case *performance.EventMetrics:
			m := map[string]float64{}
			for _, kv := range e.Metrics {
				m[kv.Name] = kv.Value
			}
			sink.Emit(events.New(events.KindPerfMonitor, c.Name(), events.PerfMonitorSample{
				Title: e.Title, Metrics: m,
			}))
		case *page.EventLifecycleEvent:
			sink.Emit(events.New(events.KindLifecycle, c.Name(), events.Lifecycle{
				Name: e.Name, FrameID: string(e.FrameID), Timestamp: float64(e.Timestamp.Time().UnixMilli()),
			}))
		case *page.EventFrameNavigated:
			if e.Frame != nil {
				sink.Emit(events.New(events.KindNavigated, c.Name(), events.Navigated{URL: e.Frame.URL}))
			}
		}
	})

	tasks := []chromedp.Action{}
	tasks = append(tasks, chromedp.ActionFunc(func(ctx context.Context) error {
		return page.Enable().Do(ctx)
	}))
	if c.opts.EnableLifecycle {
		tasks = append(tasks, chromedp.ActionFunc(func(ctx context.Context) error {
			return page.SetLifecycleEventsEnabled(true).Do(ctx)
		}))
	}
	if c.opts.EnableNetwork {
		tasks = append(tasks, network.Enable())
	}
	if c.opts.EnableConsole {
		tasks = append(tasks, runtime.Enable(), log.Enable())
	}
	if c.opts.EnablePerformance || c.opts.EnablePerfMonitor {
		domain := performance.EnableTimeDomainTimeTicks
		tasks = append(tasks, chromedp.ActionFunc(func(ctx context.Context) error {
			return performance.Enable().WithTimeDomain(domain).Do(ctx)
		}))
	}
	if c.opts.NavigateURL != "" {
		tasks = append(tasks, chromedp.Navigate(c.opts.NavigateURL))
	}

	if err := chromedp.Run(c.tab, tasks...); err != nil {
		return fmt.Errorf("chromedp run: %w", err)
	}
	sink.Emit(events.New(events.KindMeta, c.Name(), events.Meta{Message: "attached"}))
	return nil
}

func (c *Chromedp) SnapshotMetrics(ctx context.Context) (events.PerfMetrics, error) {
	if c.tab == nil {
		return events.PerfMetrics{}, errors.New("not started")
	}
	var raw []*performance.Metric
	err := chromedp.Run(c.tab, chromedp.ActionFunc(func(ctx context.Context) error {
		var derr error
		raw, derr = performance.GetMetrics().Do(ctx)
		return derr
	}))
	if err != nil {
		return events.PerfMetrics{}, err
	}
	out := events.PerfMetrics{Metrics: map[string]float64{}}
	for _, kv := range raw {
		out.Metrics[kv.Name] = kv.Value
	}
	return out, nil
}

func (c *Chromedp) Stop() error {
	if c.tabCl != nil {
		c.tabCl()
	}
	if c.browserCl != nil {
		c.browserCl()
	}
	if c.allocClose != nil {
		c.allocClose()
	}
	return nil
}

func flattenHeaders(h network.Headers) map[string]string {
	out := map[string]string{}
	for k, v := range h {
		switch t := v.(type) {
		case string:
			out[k] = t
		default:
			out[k] = fmt.Sprintf("%v", t)
		}
	}
	return out
}
