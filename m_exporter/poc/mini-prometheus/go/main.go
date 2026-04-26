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
)

func main() {
	configPath := flag.String("config", "config.toml", "path to config file (TOML)")
	flag.Parse()

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	log.Printf("loaded config from %s: addr=%s retention=%d jobs=%d",
		*configPath, cfg.Server.ListenAddr, cfg.Storage.RetentionSamples, len(cfg.Scrape))

	storage := NewStorage(cfg.Storage.RetentionSamples)
	scrape := NewScrapeManager(cfg.Scrape, storage)
	api := &API{storage: storage, scrape: scrape}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	scrape.Run(ctx)

	mux := http.NewServeMux()
	api.Routes(mux)
	mux.HandleFunc("/", indexHandler(scrape))

	srv := &http.Server{
		Addr:              cfg.Server.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		log.Printf("listening on %s", cfg.Server.ListenAddr)
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
