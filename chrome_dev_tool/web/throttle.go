package web

import (
	"context"
	"errors"
	"fmt"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
)

// ThrottleParams is the JSON body of POST /api/throttle.
type ThrottleParams struct {
	// NetworkPreset selects a Network.emulateNetworkConditions profile.
	// Empty leaves networking untouched.
	NetworkPreset string `json:"networkPreset,omitempty"`
	// CPURate is the multiplier passed to Emulation.setCPUThrottlingRate.
	// 1 = no throttling, 4 = 4× slower, etc. 0 leaves CPU untouched.
	CPURate float64 `json:"cpuRate,omitempty"`
}

type netConditions struct {
	Offline            bool    `json:"offline"`
	DownloadThroughput float64 `json:"downloadThroughput"`
	UploadThroughput   float64 `json:"uploadThroughput"`
	Latency            float64 `json:"latency"`
}

// Network presets — values mirror Chrome DevTools' built-in throttling
// profiles. download/upload are bytes-per-second; latency is milliseconds.
// (-1 download/upload disables throttling.)
var networkPresets = map[string]netConditions{
	"online":   {Offline: false, DownloadThroughput: -1, UploadThroughput: -1, Latency: 0},
	"offline":  {Offline: true, DownloadThroughput: 0, UploadThroughput: 0, Latency: 0},
	"slow-3g":  {Offline: false, DownloadThroughput: 50 * 1024, UploadThroughput: 50 * 1024, Latency: 2000},
	"fast-3g":  {Offline: false, DownloadThroughput: 180 * 1024, UploadThroughput: 84 * 1024, Latency: 562},
	"slow-4g":  {Offline: false, DownloadThroughput: 400 * 1024, UploadThroughput: 400 * 1024, Latency: 400},
	"fast-4g":  {Offline: false, DownloadThroughput: 4 * 1024 * 1024, UploadThroughput: 3 * 1024 * 1024, Latency: 20},
}

// applyThrottling sends the appropriate CDP commands.
func applyThrottling(ctx context.Context, cl *cdp.Client, p ThrottleParams) error {
	if cl == nil {
		return errors.New("not attached")
	}
	if p.NetworkPreset != "" {
		cond, ok := networkPresets[p.NetworkPreset]
		if !ok {
			return fmt.Errorf("unknown network preset %q", p.NetworkPreset)
		}
		// Network.emulateNetworkConditions requires Network.enable; idempotent.
		if _, err := cl.Send(ctx, "Network.enable", nil); err != nil {
			return fmt.Errorf("Network.enable: %w", err)
		}
		params := map[string]any{
			"offline":            cond.Offline,
			"latency":            cond.Latency,
			"downloadThroughput": cond.DownloadThroughput,
			"uploadThroughput":   cond.UploadThroughput,
		}
		if _, err := cl.Send(ctx, "Network.emulateNetworkConditions", params); err != nil {
			return fmt.Errorf("Network.emulateNetworkConditions: %w", err)
		}
	}
	if p.CPURate > 0 {
		if _, err := cl.Send(ctx, "Emulation.setCPUThrottlingRate", map[string]any{"rate": p.CPURate}); err != nil {
			return fmt.Errorf("Emulation.setCPUThrottlingRate: %w", err)
		}
	}
	return nil
}
