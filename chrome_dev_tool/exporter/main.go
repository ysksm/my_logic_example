// cdt-exporter is a Prometheus exporter for Chrome DevTools Protocol
// metrics. It attaches to a Chrome with --remote-debugging-port (or
// launches one), wires the same collector the WebUI uses, and serves a
// Prometheus-format /metrics endpoint.
//
// Usage example (against an already-launched Chrome):
//
//	chrome --remote-debugging-port=9222 https://example.com
//	cdt-exporter --cdp-port=9222 --listen=:9101
//	curl http://localhost:9101/metrics
//
// Usage example (auto-launch headless Chromium):
//
//	cdt-exporter --launch --launch-url=https://example.com --launch-headless
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/browser"
)

const exporterVersion = "0.1.0"

func main() {
	var (
		listen       = flag.String("listen", ":9101", "HTTP listen address")
		metricsPath  = flag.String("metrics-path", "/metrics", "URL path under which to expose metrics")
		cdpHost      = flag.String("cdp-host", "127.0.0.1", "Chrome DevTools host")
		cdpPort      = flag.Int("cdp-port", 9222, "Chrome DevTools port (--remote-debugging-port)")
		targetIndex  = flag.Int("target-index", 0, "Page target index (from /json)")
		navigateURL  = flag.String("navigate", "", "Navigate to URL once attached")
		perfInterval = flag.Duration("perf-interval", 1*time.Second, "Performance.getMetrics polling interval")

		doLaunch   = flag.Bool("launch", false, "Launch a Chromium ourselves instead of attaching to an existing one")
		launchURL  = flag.String("launch-url", "about:blank", "URL to open when --launch is set")
		launchHl   = flag.Bool("launch-headless", true, "Run launched Chromium headless")
		launchExec = flag.String("launch-chromium", "", "Explicit chromium binary path (empty = auto-detect)")

		retryEvery = flag.Duration("retry-interval", 5*time.Second, "How often to retry attach if the target goes away")
	)
	flag.Parse()

	logger := log.New(os.Stderr, "cdt-exporter ", log.LstdFlags|log.Lmsgprefix)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Optionally launch a Chromium ourselves.
	var proc *browser.Process
	if *doLaunch {
		p, err := browser.Launch(ctx, browser.LaunchOptions{
			ExecPath: *launchExec,
			Headless: *launchHl,
			URL:      *launchURL,
		})
		if err != nil {
			logger.Fatalf("launch chromium: %v", err)
		}
		proc = p
		*cdpHost = "127.0.0.1"
		*cdpPort = p.Port
		logger.Printf("launched %s on :%d", p.Binary(), p.Port)
		defer proc.Stop()
	}

	reg := NewRegistry()
	exp := NewExporter(reg, exporterVersion)

	// Background re-attach loop. If the page is closed or Chrome restarts,
	// we keep trying to come back online without exiting.
	go runAttachLoop(ctx, logger, exp, *cdpHost, *cdpPort, *targetIndex, *perfInterval, *navigateURL, *retryEvery)

	mux := http.NewServeMux()
	mux.HandleFunc(*metricsPath, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		reg.Render(w)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!doctype html>
<html><body style="font-family:ui-monospace,monospace">
  <h2>cdt-exporter</h2>
  <p>Chrome DevTools Prometheus exporter, version %s.</p>
  <p>Metrics: <a href="%s">%s</a></p>
  <p>Targets endpoint (debug): <a href="/debug/targets">/debug/targets</a></p>
</body></html>`, exporterVersion, *metricsPath, *metricsPath)
	})
	mux.HandleFunc("/debug/targets", func(w http.ResponseWriter, r *http.Request) {
		// Pass-through helper so users can see Chrome's tab list without
		// installing an extra HTTP client.
		dialAddr := fmt.Sprintf("http://%s:%d/json", *cdpHost, *cdpPort)
		http.Redirect(w, r, dialAddr, http.StatusFound)
	})

	srv := &http.Server{
		Addr:              *listen,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	logger.Printf("listening on %s, metrics at %s", *listen, *metricsPath)

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	select {
	case <-ctx.Done():
		logger.Printf("shutdown signal received")
		shutCtx, c2 := context.WithTimeout(context.Background(), 5*time.Second)
		defer c2()
		_ = srv.Shutdown(shutCtx)
		exp.Stop()
		if proc != nil {
			_ = proc.Stop()
		}
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			logger.Fatalf("server: %v", err)
		}
	}
}

// runAttachLoop keeps the exporter attached. On any failure it logs,
// marks attached=0, waits retryEvery, and tries again.
func runAttachLoop(
	ctx context.Context,
	logger *log.Logger,
	exp *Exporter,
	host string,
	port int,
	index int,
	perfInterval time.Duration,
	navigate string,
	retryEvery time.Duration,
) {
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		attachCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := exp.AttachAndCollect(attachCtx, host, port, index, perfInterval, navigate)
		cancel()
		if err != nil {
			logger.Printf("attach failed: %v (retrying in %s)", err, retryEvery)
			select {
			case <-ctx.Done():
				return
			case <-time.After(retryEvery):
				continue
			}
		}
		logger.Printf("attached to %s:%d (target #%d)", host, port, index)

		// Wait for the underlying CDP connection to close, then loop.
		cl := exp.CDPClient()
		if cl == nil {
			// Defensive: should never happen right after AttachAndCollect.
			select {
			case <-ctx.Done():
				return
			case <-time.After(retryEvery):
			}
			continue
		}
		select {
		case <-ctx.Done():
			exp.Stop()
			return
		case <-cl.Done():
			logger.Printf("CDP connection closed, will re-attach in %s", retryEvery)
			exp.Stop()
			select {
			case <-ctx.Done():
				return
			case <-time.After(retryEvery):
			}
		}
	}
}
