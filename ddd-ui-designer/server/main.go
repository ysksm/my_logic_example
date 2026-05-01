package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/api"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/storage"
)

func main() {
	addr := flag.String("addr", ":8095", "listen address")
	dataDir := flag.String("data", "./data", "directory for JSON-persisted domains")
	flag.Parse()

	store, err := storage.New(*dataDir)
	if err != nil {
		log.Fatalf("storage: %v", err)
	}
	srv := &http.Server{
		Addr:    *addr,
		Handler: api.Handler(store),
	}
	log.Printf("ddd-ui-designer listening on %s (data=%s)", *addr, *dataDir)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
