package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	configPath := flag.String("config", "config.toml", "path to config file (TOML)")
	flag.Parse()

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	log.Printf("loaded config from %s: addr=%s path=%s interval=%s unit=%s",
		*configPath, cfg.Server.ListenAddr, cfg.Server.MetricsPath, cfg.Collector.Interval.Duration, cfg.Collector.Unit)

	reg := prometheus.NewRegistry()
	if err := registerMetrics(reg, cfg.Collector.Unit); err != nil {
		log.Fatalf("register metrics: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go runCollector(ctx, cfg.Collector.Interval.Duration)

	mux := http.NewServeMux()
	mux.Handle(cfg.Server.MetricsPath, promhttp.HandlerFor(reg, promhttp.HandlerOpts{Registry: reg}))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!doctype html><title>m_exporter (go)</title>` +
			`<h1>m_exporter (go)</h1><p><a href="` + cfg.Server.MetricsPath + `">metrics</a></p>`))
	})

	srv := &http.Server{
		Addr:              cfg.Server.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("listening on %s%s", cfg.Server.ListenAddr, cfg.Server.MetricsPath)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Printf("shutdown signal received")
	case err := <-errCh:
		log.Printf("server error: %v", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown: %v", err)
	}
}
