package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/api"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/runner"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/storage"
)

func main() {
	addr := flag.String("addr", ":8095", "listen address")
	dataDir := flag.String("data", "./data", "directory for JSON-persisted domains")
	runsDir := flag.String("runs", "./runs", "directory where generated apps are written and run")
	flag.Parse()

	store, err := storage.New(*dataDir)
	if err != nil {
		log.Fatalf("storage: %v", err)
	}
	mgr, err := runner.New(*runsDir)
	if err != nil {
		log.Fatalf("runner: %v", err)
	}
	defer mgr.StopAll()

	srv := &http.Server{
		Addr:    *addr,
		Handler: api.Handler(store, mgr),
	}
	log.Printf("ddd-ui-designer listening on %s (data=%s runs=%s)", *addr, *dataDir, *runsDir)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	log.Println("shutting down: stopping child dev servers...")
	mgr.StopAll()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Println("bye")
}
