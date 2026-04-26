package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

// TargetStatus holds the most recent scrape result for a single endpoint.
type TargetStatus struct {
	JobName    string    `json:"-"`
	URL        string    `json:"-"`
	Health     string    `json:"health"`     // "up" / "down" / "unknown"
	LastScrape time.Time `json:"-"`
	LastError  string    `json:"lastError"`
	LastDurMS  float64   `json:"-"`
}

// ScrapeManager owns one goroutine per (job, target) pair.
type ScrapeManager struct {
	cfg     []*ScrapeConfig
	storage *Storage

	mu      sync.RWMutex
	targets []*TargetStatus
}

func NewScrapeManager(cfg []*ScrapeConfig, st *Storage) *ScrapeManager {
	m := &ScrapeManager{cfg: cfg, storage: st}
	for _, sc := range cfg {
		for _, t := range sc.Targets {
			m.targets = append(m.targets, &TargetStatus{
				JobName: sc.JobName,
				URL:     fmt.Sprintf("%s://%s%s", sc.Scheme, t, sc.MetricsPath),
				Health:  "unknown",
			})
		}
	}
	return m
}

func (m *ScrapeManager) Run(ctx context.Context) {
	for _, sc := range m.cfg {
		for _, t := range sc.Targets {
			job := sc.JobName
			target := t
			interval := sc.ScrapeInterval.Duration
			timeout := sc.ScrapeTimeout.Duration
			path := sc.MetricsPath
			scheme := sc.Scheme
			go m.runOne(ctx, job, target, scheme, path, interval, timeout)
		}
	}
}

func (m *ScrapeManager) findStatus(job, url string) *TargetStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, ts := range m.targets {
		if ts.JobName == job && ts.URL == url {
			return ts
		}
	}
	return nil
}

func (m *ScrapeManager) runOne(ctx context.Context, job, target, scheme, path string, interval, timeout time.Duration) {
	url := fmt.Sprintf("%s://%s%s", scheme, target, path)
	client := &http.Client{Timeout: timeout}
	// Initial scrape immediately, then on ticker.
	m.scrapeOnce(ctx, client, job, target, url)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.scrapeOnce(ctx, client, job, target, url)
		}
	}
}

func (m *ScrapeManager) scrapeOnce(ctx context.Context, client *http.Client, job, target, url string) {
	ts := m.findStatus(job, url)
	if ts == nil {
		return
	}
	start := time.Now()
	defer func() {
		ts.LastScrape = start
		ts.LastDurMS = float64(time.Since(start).Microseconds()) / 1000.0
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		ts.Health = "down"
		ts.LastError = err.Error()
		return
	}
	req.Header.Set("Accept", "text/plain;version=0.0.4;q=0.9,application/openmetrics-text;q=0.7,*/*;q=0.5")
	resp, err := client.Do(req)
	if err != nil {
		ts.Health = "down"
		ts.LastError = err.Error()
		log.Printf("scrape %s: %v", url, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		ts.Health = "down"
		ts.LastError = fmt.Sprintf("status %d", resp.StatusCode)
		return
	}
	parsed, err := ParseTextFormat(resp.Body)
	if err != nil {
		ts.Health = "down"
		ts.LastError = err.Error()
		return
	}

	ingestTS := start.UnixMilli()
	for _, p := range parsed {
		extra := make(Labels, 0, len(p.Labels)+2)
		extra = append(extra, p.Labels...)
		extra = append(extra, Label{Name: "job", Value: job})
		extra = append(extra, Label{Name: "instance", Value: target})
		t := p.TS
		if t == 0 {
			t = ingestTS
		}
		m.storage.Append(p.Metric, extra, t, p.Value)
	}
	// Synthetic metrics, mirroring Prometheus.
	m.storage.Append("up", Labels{
		{Name: "job", Value: job},
		{Name: "instance", Value: target},
	}, ingestTS, 1)
	m.storage.Append("scrape_duration_seconds", Labels{
		{Name: "job", Value: job},
		{Name: "instance", Value: target},
	}, ingestTS, time.Since(start).Seconds())
	m.storage.Append("scrape_samples_scraped", Labels{
		{Name: "job", Value: job},
		{Name: "instance", Value: target},
	}, ingestTS, float64(len(parsed)))

	ts.Health = "up"
	ts.LastError = ""
}

// Targets returns a snapshot of the current target statuses.
func (m *ScrapeManager) Targets() []*TargetStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*TargetStatus, len(m.targets))
	copy(out, m.targets)
	return out
}
