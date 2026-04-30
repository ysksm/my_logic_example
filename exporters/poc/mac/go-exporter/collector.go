package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
)

var (
	cpuUsage             *prometheus.GaugeVec
	memTotalBytes        prometheus.Gauge
	memUsedBytes         prometheus.Gauge
	memAvailableBytes    prometheus.Gauge
	memUsage             prometheus.Gauge
	swapTotalBytes       prometheus.Gauge
	swapUsedBytes        prometheus.Gauge
	swapUsage            prometheus.Gauge
	collectorLastSuccess prometheus.Gauge
	collectorErrorsTotal *prometheus.CounterVec

	// unitScale converts gopsutil's 0-100 percent into the configured unit.
	// ratio:   0.01  (so 80 → 0.8)
	// percent: 1.0   (so 80 → 80)
	unitScale float64
)

func registerMetrics(reg prometheus.Registerer, unit string) error {
	var (
		suffix string
		rng    string
	)
	switch unit {
	case "ratio":
		suffix, rng, unitScale = "ratio", "(0-1)", 0.01
	case "percent":
		suffix, rng, unitScale = "percent", "(0-100)", 1.0
	default:
		return fmt.Errorf("invalid unit %q: must be \"ratio\" or \"percent\"", unit)
	}

	cpuUsage = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "mac_exporter_cpu_usage_" + suffix,
			Help: "CPU usage " + suffix + " " + rng + " per logical core, plus cpu=\"total\".",
		},
		[]string{"cpu"},
	)
	memTotalBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_memory_total_bytes",
		Help: "Total physical memory in bytes.",
	})
	memUsedBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_memory_used_bytes",
		Help: "Used physical memory in bytes.",
	})
	memAvailableBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_memory_available_bytes",
		Help: "Memory available for new allocations, in bytes.",
	})
	memUsage = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_memory_used_" + suffix,
		Help: "Used memory " + suffix + " " + rng + ".",
	})
	swapTotalBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_swap_total_bytes",
		Help: "Total swap in bytes.",
	})
	swapUsedBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_swap_used_bytes",
		Help: "Used swap in bytes.",
	})
	swapUsage = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_swap_used_" + suffix,
		Help: "Used swap " + suffix + " " + rng + ".",
	})
	collectorLastSuccess = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "mac_exporter_collector_last_success_timestamp_seconds",
		Help: "Unix timestamp of the last successful background collection.",
	})
	collectorErrorsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "mac_exporter_collector_errors_total",
			Help: "Number of background collection errors, by source.",
		},
		[]string{"source"},
	)

	reg.MustRegister(
		cpuUsage,
		memTotalBytes, memUsedBytes, memAvailableBytes, memUsage,
		swapTotalBytes, swapUsedBytes, swapUsage,
		collectorLastSuccess, collectorErrorsTotal,
	)
	return nil
}

func runCollector(ctx context.Context, interval time.Duration) {
	if _, err := cpu.PercentWithContext(ctx, 0, true); err != nil {
		log.Printf("collector: cpu seed failed: %v", err)
	}

	collectOnce(ctx)

	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			collectOnce(ctx)
		}
	}
}

func collectOnce(ctx context.Context) {
	ok := true

	if perCore, err := cpu.PercentWithContext(ctx, 0, true); err != nil {
		ok = false
		collectorErrorsTotal.WithLabelValues("cpu").Inc()
		log.Printf("collector: cpu.Percent: %v", err)
	} else {
		var sum float64
		for i, p := range perCore {
			cpuUsage.WithLabelValues(strconv.Itoa(i)).Set(p * unitScale)
			sum += p
		}
		if n := len(perCore); n > 0 {
			cpuUsage.WithLabelValues("total").Set(sum / float64(n) * unitScale)
		}
	}

	if vm, err := mem.VirtualMemoryWithContext(ctx); err != nil {
		ok = false
		collectorErrorsTotal.WithLabelValues("memory").Inc()
		log.Printf("collector: mem.VirtualMemory: %v", err)
	} else {
		memTotalBytes.Set(float64(vm.Total))
		memUsedBytes.Set(float64(vm.Used))
		memAvailableBytes.Set(float64(vm.Available))
		memUsage.Set(vm.UsedPercent * unitScale)
	}

	if sm, err := mem.SwapMemoryWithContext(ctx); err != nil {
		ok = false
		collectorErrorsTotal.WithLabelValues("swap").Inc()
		log.Printf("collector: mem.SwapMemory: %v", err)
	} else {
		swapTotalBytes.Set(float64(sm.Total))
		swapUsedBytes.Set(float64(sm.Used))
		swapUsage.Set(sm.UsedPercent * unitScale)
	}

	if ok {
		collectorLastSuccess.SetToCurrentTime()
	}
}
