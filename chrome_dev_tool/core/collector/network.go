package collector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

func wireNetwork(ctx context.Context, cl *cdp.Client, sink Sink) error {
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
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		sink.Emit(events.New(events.KindNetworkRequest, events.NetworkRequest{
			RequestID: wrap.RequestID,
			URL:       wrap.Request.URL,
			Method:    wrap.Request.Method,
			Type:      wrap.Type,
			Headers:   wrap.Request.Headers,
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
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		sink.Emit(events.New(events.KindNetworkResponse, events.NetworkResponse{
			RequestID:  wrap.RequestID,
			URL:        wrap.Response.URL,
			Status:     wrap.Response.Status,
			StatusText: wrap.Response.StatusText,
			MimeType:   wrap.Response.MimeType,
			Headers:    wrap.Response.Headers,
			FromCache:  wrap.Response.FromCache,
			Protocol:   wrap.Response.Protocol,
		}))
	})

	cl.On("Network.loadingFinished", func(p json.RawMessage) {
		var v events.NetworkFinished
		if err := json.Unmarshal(p, &v); err != nil {
			return
		}
		sink.Emit(events.New(events.KindNetworkFinished, v))
	})

	cl.On("Network.loadingFailed", func(p json.RawMessage) {
		var wrap struct {
			RequestID string `json:"requestId"`
			ErrorText string `json:"errorText"`
			Canceled  bool   `json:"canceled"`
		}
		if err := json.Unmarshal(p, &wrap); err != nil {
			return
		}
		sink.Emit(events.New(events.KindNetworkFailed, events.NetworkFailed{
			RequestID: wrap.RequestID,
			ErrorText: wrap.ErrorText,
			Canceled:  wrap.Canceled,
		}))
	})

	return nil
}
