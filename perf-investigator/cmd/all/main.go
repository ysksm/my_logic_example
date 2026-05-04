// Command pi-all is a single-binary perf-investigator. It:
//
//  1. Auto-launches Chrome via rod's launcher (uses the local Chrome on
//     macOS / Windows / Linux when present; downloads Chromium otherwise).
//  2. Starts the HTTP+WebSocket hub.
//  3. Attaches the rod collector to the launched browser.
//  4. Opens the React WebUI in the user's default browser.
//
// The React build is embedded into the binary so no separate `npm run
// build` step is required at runtime.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/go-rod/rod/lib/launcher"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/collectors"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/recorder"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/server"
)

//go:embed all:dist
var dist embed.FS

func main() {
	addr := flag.String("addr", ":7681", "WebUI listen address")
	target := flag.String("url", "https://example.com", "URL to open in the launched browser")
	headless := flag.Bool("headless", false, "run Chrome headless")
	chromeBin := flag.String("chrome", "", "path to Chrome/Chromium binary (empty = auto-detect)")
	noOpen := flag.Bool("no-open", false, "don't auto-open the WebUI in the default browser")
	recDir := flag.String("record", "./recordings", "NDJSON recordings directory ('' to disable)")
	source := flag.String("source", "rod", "collector backend: rod|chromedp|raw (rod recommended for auto-launch)")
	flag.Parse()

	// 1. Launch Chrome via rod.
	l := launcher.New().Headless(*headless).Devtools(false)
	if *chromeBin != "" {
		l = l.Bin(*chromeBin)
	}
	wsURL, err := l.Launch()
	if err != nil {
		log.Fatalf("rod launch: %v\n\nIf Chrome isn't installed, install it from https://www.google.com/chrome/\nor pass -chrome /path/to/chromium.", err)
	}
	defer l.Cleanup()
	log.Printf("Chrome attached at %s", wsURL)

	host, port, err := splitHostPort(wsURL)
	if err != nil {
		log.Fatalf("parse ws url: %v", err)
	}

	// 2. Set up recorder + hub.
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

	// 3. Start the collector with sensible defaults.
	opts := collectors.Options{
		CDPHost:           host,
		CDPPort:           port,
		NavigateURL:       *target,
		EnableNetwork:     true,
		EnableConsole:     true,
		EnablePerformance: true,
		EnablePerfMonitor: true,
		EnableLifecycle:   true,
	}
	c, err := server.Build(*source, opts)
	if err != nil {
		log.Fatalf("build collector: %v", err)
	}

	ctx, cancel := signalContext()
	defer cancel()

	if err := c.Start(ctx, hub); err != nil {
		log.Fatalf("collector start: %v", err)
	}
	log.Printf("%s collector attached, navigating to %s", c.Name(), *target)

	// 4. Serve embedded UI.
	uiFS, err := fs.Sub(dist, "dist")
	if err != nil || !hasIndex(uiFS) {
		log.Printf("embedded UI missing — run `make web` and rebuild; serving API only")
		uiFS = nil
	}

	go func() {
		if *noOpen {
			return
		}
		time.Sleep(300 * time.Millisecond)
		uiURL := fmt.Sprintf("http://localhost%s", *addr)
		if err := openBrowser(uiURL); err != nil {
			log.Printf("open browser: %v (open %s manually)", err, uiURL)
		}
	}()

	srv := &http.Server{Addr: *addr, Handler: hub.Router(uiFS)}
	go func() {
		<-ctx.Done()
		_ = srv.Shutdown(context.Background())
	}()
	log.Printf("WebUI listening on %s — Ctrl+C to stop", *addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	_ = c.Stop()
}

// splitHostPort accepts ws://host:port/... and returns ("host", port).
func splitHostPort(wsURL string) (string, int, error) {
	u, err := url.Parse(wsURL)
	if err != nil {
		return "", 0, err
	}
	host := u.Hostname()
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		return "", 0, fmt.Errorf("port: %w", err)
	}
	return host, port, nil
}

func hasIndex(f fs.FS) bool {
	if f == nil {
		return false
	}
	_, err := fs.Stat(f, "index.html")
	return err == nil
}

func openBrowser(u string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", u).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	default:
		return exec.Command("xdg-open", u).Start()
	}
}

func signalContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		cancel()
	}()
	return ctx, cancel
}
