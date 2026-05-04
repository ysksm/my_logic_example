// Command perf-investigator-server hosts the WebUI: HTTP control plane on
// /api/* and a WebSocket fan-out at /ws. The React build is served from
// -ui (default ./web/dist) when present.
package main

import (
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/recorder"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/server"
)

func main() {
	addr := flag.String("addr", ":7681", "listen address")
	uiDir := flag.String("ui", "./web/dist", "directory containing React build (skip if missing)")
	recDir := flag.String("record", "./recordings", "NDJSON recordings directory ('' to disable)")
	flag.Parse()

	var rec *recorder.Recorder
	if *recDir != "" {
		r, err := recorder.New(*recDir, "pi")
		if err != nil {
			log.Fatalf("recorder: %v", err)
		}
		defer r.Close()
		rec = r
		log.Printf("recording to %s", *recDir)
	}

	hub := server.NewHub(rec)

	var uiFS fs.FS
	if *uiDir != "" {
		abs, _ := filepath.Abs(*uiDir)
		if st, err := os.Stat(abs); err == nil && st.IsDir() {
			uiFS = os.DirFS(abs)
			log.Printf("serving UI from %s", abs)
		} else {
			log.Printf("UI dir %s missing — only API will be available", abs)
		}
	}

	log.Printf("listening on %s", *addr)
	if err := http.ListenAndServe(*addr, hub.Router(uiFS)); err != nil {
		log.Fatal(err)
	}
}
