package collectors

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/cdp"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
)

// Raw is a Collector built directly on the in-house CDP WS client. No
// chromedp, no rod — useful when you want a clear picture of which CDP
// methods are actually firing.
type Raw struct {
	opts   Options
	client *cdp.Client
	target *cdp.Target
}

func NewRaw(opts Options) *Raw { return &Raw{opts: opts} }

func (r *Raw) Name() string { return "raw" }

func (r *Raw) Start(ctx context.Context, sink Sink) error {
	cl, tgt, err := cdp.DialFirstPage(ctx, r.opts.CDPHost, r.opts.CDPPort, r.opts.TargetIndex)
	if err != nil {
		return err
	}
	r.client = cl
	r.target = tgt
	sink.Emit(events.New(events.KindMeta, r.Name(), events.Meta{
		Message: "attached", Extra: map[string]any{"target": tgt.URL, "id": tgt.ID},
	}))

	if _, err := cl.Send(ctx, "Page.enable", nil); err != nil {
		return fmt.Errorf("Page.enable: %w", err)
	}

	if r.opts.EnableLifecycle {
		if _, err := cl.Send(ctx, "Page.setLifecycleEventsEnabled", map[string]any{"enabled": true}); err == nil {
			cl.On("Page.lifecycleEvent", func(p json.RawMessage) {
				var v events.Lifecycle
				_ = json.Unmarshal(p, &v)
				sink.Emit(events.New(events.KindLifecycle, r.Name(), v))
			})
		}
		cl.On("Page.frameNavigated", func(p json.RawMessage) {
			var wrap struct {
				Frame struct {
					URL string `json:"url"`
				} `json:"frame"`
			}
			_ = json.Unmarshal(p, &wrap)
			sink.Emit(events.New(events.KindNavigated, r.Name(), events.Navigated{URL: wrap.Frame.URL}))
		})
	}

	if r.opts.EnableNetwork {
		if _, err := cl.Send(ctx, "Network.enable", nil); err != nil {
			return fmt.Errorf("Network.enable: %w", err)
		}
		cl.On("Network.requestWillBeSent", func(p json.RawMessage) {
			var wrap struct {
				RequestID string `json:"requestId"`
				Type      string `json:"type"`
				Request   struct {
					URL     string            `json:"url"`
					Method  string            `json:"method"`
					Headers map[string]string `json:"headers"`
				} `json:"request"`
			}
			_ = json.Unmarshal(p, &wrap)
			sink.Emit(events.New(events.KindNetworkRequest, r.Name(), events.NetworkRequest{
				RequestID: wrap.RequestID, URL: wrap.Request.URL,
				Method: wrap.Request.Method, Type: wrap.Type, Headers: wrap.Request.Headers,
			}))
		})
		cl.On("Network.responseReceived", func(p json.RawMessage) {
			var wrap struct {
				RequestID string `json:"requestId"`
				Response  struct {
					URL        string            `json:"url"`
					Status     int               `json:"status"`
					StatusText string            `json:"statusText"`
					MimeType   string            `json:"mimeType"`
					Headers    map[string]string `json:"headers"`
					FromCache  bool              `json:"fromDiskCache"`
					Protocol   string            `json:"protocol"`
				} `json:"response"`
			}
			_ = json.Unmarshal(p, &wrap)
			sink.Emit(events.New(events.KindNetworkResponse, r.Name(), events.NetworkResponse{
				RequestID: wrap.RequestID, URL: wrap.Response.URL,
				Status: wrap.Response.Status, StatusText: wrap.Response.StatusText,
				MimeType: wrap.Response.MimeType, Headers: wrap.Response.Headers,
				FromCache: wrap.Response.FromCache, Protocol: wrap.Response.Protocol,
			}))
		})
		cl.On("Network.loadingFinished", func(p json.RawMessage) {
			var v events.NetworkFinished
			_ = json.Unmarshal(p, &v)
			sink.Emit(events.New(events.KindNetworkFinished, r.Name(), v))
		})
		cl.On("Network.loadingFailed", func(p json.RawMessage) {
			var wrap struct {
				RequestID string `json:"requestId"`
				ErrorText string `json:"errorText"`
				Canceled  bool   `json:"canceled"`
			}
			_ = json.Unmarshal(p, &wrap)
			sink.Emit(events.New(events.KindNetworkFailed, r.Name(), events.NetworkFailed{
				RequestID: wrap.RequestID, ErrorText: wrap.ErrorText, Canceled: wrap.Canceled,
			}))
		})
	}

	if r.opts.EnableConsole {
		if _, err := cl.Send(ctx, "Runtime.enable", nil); err != nil {
			return fmt.Errorf("Runtime.enable: %w", err)
		}
		if _, err := cl.Send(ctx, "Log.enable", nil); err != nil {
			return fmt.Errorf("Log.enable: %w", err)
		}
		cl.On("Runtime.consoleAPICalled", func(p json.RawMessage) {
			var wrap struct {
				Type string `json:"type"`
				Args []struct {
					Type        string          `json:"type"`
					Value       json.RawMessage `json:"value,omitempty"`
					Description string          `json:"description,omitempty"`
				} `json:"args"`
			}
			_ = json.Unmarshal(p, &wrap)
			text := ""
			for i, a := range wrap.Args {
				if i > 0 {
					text += " "
				}
				if len(a.Value) > 0 {
					text += string(a.Value)
				} else {
					text += a.Description
				}
			}
			sink.Emit(events.New(events.KindConsole, r.Name(), events.ConsoleEntry{
				Level: wrap.Type, Text: text,
			}))
		})
		cl.On("Runtime.exceptionThrown", func(p json.RawMessage) {
			var wrap struct {
				ExceptionDetails struct {
					Text       string `json:"text"`
					URL        string `json:"url"`
					LineNumber int    `json:"lineNumber"`
					Exception  struct {
						Description string `json:"description"`
					} `json:"exception"`
				} `json:"exceptionDetails"`
			}
			_ = json.Unmarshal(p, &wrap)
			text := wrap.ExceptionDetails.Text
			if d := wrap.ExceptionDetails.Exception.Description; d != "" {
				text = d
			}
			sink.Emit(events.New(events.KindException, r.Name(), events.ConsoleEntry{
				Level: "error", Text: text,
				URL: wrap.ExceptionDetails.URL, Line: wrap.ExceptionDetails.LineNumber,
			}))
		})
		cl.On("Log.entryAdded", func(p json.RawMessage) {
			var wrap struct {
				Entry struct {
					Source string `json:"source"`
					Level  string `json:"level"`
					Text   string `json:"text"`
					URL    string `json:"url"`
				} `json:"entry"`
			}
			_ = json.Unmarshal(p, &wrap)
			sink.Emit(events.New(events.KindLog, r.Name(), events.ConsoleEntry{
				Level: wrap.Entry.Level, Text: wrap.Entry.Text, URL: wrap.Entry.URL,
			}))
		})
	}

	if r.opts.EnablePerformance || r.opts.EnablePerfMonitor {
		params := map[string]any{}
		if r.opts.EnablePerfMonitor {
			params["timeDomain"] = "timeTicks"
		}
		if _, err := cl.Send(ctx, "Performance.enable", params); err != nil {
			return fmt.Errorf("Performance.enable: %w", err)
		}
		if r.opts.EnablePerfMonitor {
			cl.On("Performance.metrics", func(p json.RawMessage) {
				var wrap struct {
					Title   string `json:"title"`
					Metrics []struct {
						Name  string  `json:"name"`
						Value float64 `json:"value"`
					} `json:"metrics"`
				}
				_ = json.Unmarshal(p, &wrap)
				m := map[string]float64{}
				for _, kv := range wrap.Metrics {
					m[kv.Name] = kv.Value
				}
				sink.Emit(events.New(events.KindPerfMonitor, r.Name(), events.PerfMonitorSample{
					Title: wrap.Title, Metrics: m,
				}))
			})
		}
	}

	if r.opts.NavigateURL != "" {
		if _, err := cl.Send(ctx, "Page.navigate", map[string]any{"url": r.opts.NavigateURL}); err != nil {
			return fmt.Errorf("Page.navigate: %w", err)
		}
	}
	return nil
}

func (r *Raw) SnapshotMetrics(ctx context.Context) (events.PerfMetrics, error) {
	if r.client == nil {
		return events.PerfMetrics{}, errors.New("not started")
	}
	raw, err := r.client.Send(ctx, "Performance.getMetrics", nil)
	if err != nil {
		return events.PerfMetrics{}, err
	}
	var wrap struct {
		Metrics []struct {
			Name  string  `json:"name"`
			Value float64 `json:"value"`
		} `json:"metrics"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return events.PerfMetrics{}, err
	}
	out := events.PerfMetrics{Metrics: map[string]float64{}}
	for _, kv := range wrap.Metrics {
		out.Metrics[kv.Name] = kv.Value
	}
	return out, nil
}

func (r *Raw) Stop() error {
	if r.client != nil {
		return r.client.Close()
	}
	return nil
}
