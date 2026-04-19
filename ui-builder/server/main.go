// Package main is the entry point for the UI-builder API server.
//
// The server hosts three concerns:
//   1. DataModel definitions (Rails-like schemas).
//   2. App metadata (screens, components, transitions) used by the React builder.
//   3. Dynamic record CRUD over the user-defined models.
//
// Storage is a single JSON file per concern under ./data so the project
// works without an external database.
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/ysksm/my_logic_example/ui-builder/server/internal/api"
	"github.com/ysksm/my_logic_example/ui-builder/server/internal/storage"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	dataDir := flag.String("data", "./data", "Directory used for JSON storage")
	flag.Parse()

	store, err := storage.New(*dataDir)
	if err != nil {
		log.Fatalf("storage: %v", err)
	}

	mux := http.NewServeMux()
	api.Register(mux, store)

	log.Printf("ui-builder server listening on %s (data=%s)", *addr, *dataDir)
	if err := http.ListenAndServe(*addr, api.WithCORS(mux)); err != nil {
		log.Fatal(err)
	}
}
