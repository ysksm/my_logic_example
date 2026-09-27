// Command youtube-playlist-manager is a single-binary app that registers
// YouTube channels and fetches their video lists on demand, serving a web UI.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
	// Embed the tz database so the quota day (America/Los_Angeles) is correct
	// on Windows machines without a system zoneinfo.
	_ "time/tzdata"

	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/jobs"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/service"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/store"
	"github.com/ysksm/my_logic_example/youtube-playlist-manager/internal/web"
)

var version = "dev"

func defaultDataPath() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "youtube-playlist-manager", "data.json")
	}
	return filepath.Join("data", "data.json")
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address")
	dataPath := flag.String("data", envOr("YPM_DATA", defaultDataPath()), "path of the JSON data file")
	open := flag.Bool("open", true, "open the browser on start")
	apiBase := flag.String("api-base", envOr("YPM_API_BASE", ""), "override the YouTube Data API base URL (for testing)")
	youtubeBase := flag.String("youtube-base", envOr("YPM_YOUTUBE_BASE", ""), "override https://www.youtube.com for transcript fetching (for testing)")
	transcriptDelay := flag.Duration("transcript-delay", 1500*time.Millisecond, "pause between videos when fetching transcripts in bulk")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	st, err := store.Open(*dataPath)
	if err != nil {
		log.Fatalf("open data file %s: %v", *dataPath, err)
	}
	svc := service.New(st, os.Getenv("YOUTUBE_API_KEY"))
	if *apiBase != "" {
		svc.SetBaseURL(*apiBase)
	}
	if *youtubeBase != "" {
		svc.SetTranscriptBaseURL(*youtubeBase)
	}
	svc.SetTranscriptDelay(*transcriptDelay)

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen %s: %v", *addr, err)
	}
	url := "http://" + displayAddr(ln.Addr().String())
	srv := &http.Server{Handler: web.Handler(svc, jobs.NewManager(30)), ReadHeaderTimeout: 10 * time.Second}

	log.Printf("youtube-playlist-manager %s", version)
	log.Printf("data file: %s", *dataPath)
	log.Printf("listening on %s", url)
	if *open {
		go openBrowser(url)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func displayAddr(a string) string {
	host, port, err := net.SplitHostPort(a)
	if err != nil {
		return a
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return net.JoinHostPort(host, port)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
