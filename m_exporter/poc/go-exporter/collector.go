package main

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
)

var (
	cpuUsageRatio = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "m_exporter_cpu_usage_ratio",
			Help: "CPU usage ratio (0-1) per logical core, plus cpu=\"total\".",
		},
		[]string{"cpu"},
	)
	memTotalBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_memory_total_bytes",
		Help: "Total physical memory in bytes.",
	})
	memUsedBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_memory_used_bytes",
		Help: "Used physical memory in bytes.",
	})
	memAvailableBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_memory_available_bytes",
		Help: "Memory available for new allocations, in bytes.",
	})
	memUsedRatio = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_memory_used_ratio",
		Help: "Used memory ratio (0-1).",
	})
	swapTotalBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_swap_total_bytes",
		Help: "Total swap in bytes.",
	})
	swapUsedBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_swap_used_bytes",
		Help: "Used swap in bytes.",
	})
	swapUsedRatio = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_swap_used_ratio",
		Help: "Used swap ratio (0-1).",
	})
	collectorLastSuccess = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "m_exporter_collector_last_success_timestamp_seconds",
		Help: "Unix timestamp of the last successful background collection.",
	})
	collectorErrorsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "m_exporter_collector_errors_total",
			Help: "Number of background collection errors, by source.",
		},
		[]string{"source"},
	)
)

func registerMetrics(reg prometheus.Registerer) {
	reg.MustRegister(
		cpuUsageRatio,
		memTotalBytes, memUsedBytes, memAvailableBytes, memUsedRatio,
		swapTotalBytes, swapUsedBytes, swapUsedRatio,
		collectorLastSuccess, collectorErrorsTotal,
	)
}

func runCollector(ctx context.Context, interval time.Duration) {
	// Seed CPU baseline so the first tick produces a meaningful delta.
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
			cpuUsageRatio.WithLabelValues(strconv.Itoa(i)).Set(p / 100.0)
			sum += p
		}
		if n := len(perCore); n > 0 {
			cpuUsageRatio.WithLabelValues("total").Set(sum / float64(n) / 100.0)
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
		memUsedRatio.Set(vm.UsedPercent / 100.0)
	}

	if sm, err := mem.SwapMemoryWithContext(ctx); err != nil {
		ok = false
		collectorErrorsTotal.WithLabelValues("swap").Inc()
		log.Printf("collector: mem.SwapMemory: %v", err)
	} else {
		swapTotalBytes.Set(float64(sm.Total))
		swapUsedBytes.Set(float64(sm.Used))
		swapUsedRatio.Set(sm.UsedPercent / 100.0)
	}

	if ok {
		collectorLastSuccess.SetToCurrentTime()
	}
}
