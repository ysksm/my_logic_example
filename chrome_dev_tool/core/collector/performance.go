package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

// wirePerformance enables the Performance domain and starts a background
// poll on Performance.getMetrics. Performance.metrics events are not emitted
// to clients of public CDP, so we drive sampling ourselves at `interval`.
func wirePerformance(setupCtx, runCtx context.Context, cl *cdp.Client, sink Sink, interval time.Duration) error {
	if _, err := cl.Send(setupCtx, "Performance.enable", nil); err != nil {
		return fmt.Errorf("Performance.enable: %w", err)
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-runCtx.Done():
				return
			case <-cl.Done():
				return
			case <-t.C:
				ctx, cancel := context.WithTimeout(runCtx, 2*time.Second)
				sample, err := getMetricsOnce(ctx, cl)
				cancel()
				if err != nil {
					continue
				}
				sink.Emit(events.New(events.KindPerfMonitor, sample))
			}
		}
	}()
	return nil
}

func getMetricsOnce(ctx context.Context, cl *cdp.Client) (events.PerfSample, error) {
	raw, err := cl.Send(ctx, "Performance.getMetrics", nil)
	if err != nil {
		return events.PerfSample{}, err
	}
	var wrap struct {
		Metrics []struct {
			Name  string  `json:"name"`
			Value float64 `json:"value"`
		} `json:"metrics"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return events.PerfSample{}, err
	}
	m := make(map[string]float64, len(wrap.Metrics))
	for _, kv := range wrap.Metrics {
		m[kv.Name] = kv.Value
	}
	return events.PerfSample{Title: "getMetrics", Metrics: m}, nil
}
