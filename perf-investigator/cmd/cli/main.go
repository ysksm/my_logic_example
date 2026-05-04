// Command perf-investigator is the CLI for attaching to a running Chrome
// (--remote-debugging-port=9222) and streaming network/console/perf events
// to stdout and/or an NDJSON file.
//
// Subcommands:
//
//	list                            list page targets
//	watch [flags]                   stream events to stdout (and optional NDJSON)
//	snapshot [flags]                one-off Performance.getMetrics
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/cdp"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/collectors"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/recorder"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "list":
		runList(os.Args[2:])
	case "watch":
		runWatch(os.Args[2:])
	case "snapshot":
		runSnapshot(os.Args[2:])
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Println(`perf-investigator — Chrome DevTools Protocol observer

Usage:
  perf-investigator list      [-host H] [-port P]
  perf-investigator watch     [-host H] [-port P] [-source raw|chromedp|rod]
                              [-target N] [-url URL] [-record DIR]
                              [-no-network] [-no-console] [-no-perf] [-no-monitor]
  perf-investigator snapshot  [-host H] [-port P] [-source raw|chromedp|rod]

Chrome must be started with --remote-debugging-port=P (default 9222).`)
}

func sharedFlags(fs *flag.FlagSet) (*string, *int, *string, *int) {
	host := fs.String("host", "localhost", "CDP host")
	port := fs.Int("port", 9222, "CDP port")
	source := fs.String("source", "raw", "collector backend: raw|chromedp|rod")
	target := fs.Int("target", 0, "page target index")
	return host, port, source, target
}

func runList(args []string) {
	fs := flag.NewFlagSet("list", flag.ExitOnError)
	host, port, _, _ := sharedFlags(fs)
	_ = fs.Parse(args)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	targets, err := cdp.ListTargets(ctx, *host, *port)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	for i, t := range targets {
		fmt.Printf("[%d] %-7s %s — %s\n", i, t.Type, t.Title, t.URL)
	}
}

func runWatch(args []string) {
	fs := flag.NewFlagSet("watch", flag.ExitOnError)
	host, port, source, target := sharedFlags(fs)
	url := fs.String("url", "", "navigate to URL after attach (optional)")
	recordDir := fs.String("record", "", "directory to write NDJSON logs")
	noNet := fs.Bool("no-network", false, "disable Network domain")
	noCon := fs.Bool("no-console", false, "disable Runtime/Log domains")
	noPerf := fs.Bool("no-perf", false, "disable Performance domain")
	noMon := fs.Bool("no-monitor", false, "disable Performance.metrics streaming")
	jsonOut := fs.Bool("json", false, "emit raw NDJSON to stdout instead of pretty lines")
	_ = fs.Parse(args)

	opts := collectors.Options{
		CDPHost: *host, CDPPort: *port, TargetIndex: *target, NavigateURL: *url,
		EnableNetwork:     !*noNet,
		EnableConsole:     !*noCon,
		EnablePerformance: !*noPerf,
		EnablePerfMonitor: !*noMon,
		EnableLifecycle:   true,
	}

	collector, err := buildCollector(*source, opts)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	var rec *recorder.Recorder
	if *recordDir != "" {
		rec, err = recorder.New(*recordDir, "pi")
		if err != nil {
			fmt.Fprintln(os.Stderr, "recorder:", err)
			os.Exit(1)
		}
		defer rec.Close()
		fmt.Fprintf(os.Stderr, "recording to %s\n", *recordDir)
	}

	printer := collectors.SinkFunc(func(e events.Event) {
		if *jsonOut {
			b, _ := json.Marshal(e)
			fmt.Println(string(b))
			return
		}
		fmt.Println(formatEvent(e))
	})
	var sink collectors.Sink = printer
	if rec != nil {
		sink = collectors.FanOut{rec, printer}
	}

	ctx, cancel := signalContext()
	defer cancel()

	if err := collector.Start(ctx, sink); err != nil {
		fmt.Fprintln(os.Stderr, "start:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "%s collector attached. Ctrl+C to stop.\n", collector.Name())
	<-ctx.Done()
	_ = collector.Stop()
}

func runSnapshot(args []string) {
	fs := flag.NewFlagSet("snapshot", flag.ExitOnError)
	host, port, source, target := sharedFlags(fs)
	_ = fs.Parse(args)

	opts := collectors.Options{
		CDPHost: *host, CDPPort: *port, TargetIndex: *target,
		EnablePerformance: true,
	}
	collector, err := buildCollector(*source, opts)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	null := collectors.SinkFunc(func(events.Event) {})
	if err := collector.Start(ctx, null); err != nil {
		fmt.Fprintln(os.Stderr, "start:", err)
		os.Exit(1)
	}
	defer collector.Stop()
	m, err := collector.SnapshotMetrics(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "snapshot:", err)
		os.Exit(1)
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	fmt.Println(string(b))
}

func buildCollector(source string, opts collectors.Options) (collectors.Collector, error) {
	switch source {
	case "raw", "":
		return collectors.NewRaw(opts), nil
	case "chromedp":
		return collectors.NewChromedp(opts), nil
	case "rod":
		return collectors.NewRod(opts), nil
	default:
		return nil, fmt.Errorf("unknown source %q", source)
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

func formatEvent(e events.Event) string {
	t := e.Time.Format("15:04:05.000")
	switch e.Kind {
	case events.KindNetworkRequest:
		var v events.NetworkRequest
		_ = json.Unmarshal(e.Data, &v)
		return fmt.Sprintf("%s [%s] → %s %s %s", t, e.Source, v.Method, v.Type, trim(v.URL, 100))
	case events.KindNetworkResponse:
		var v events.NetworkResponse
		_ = json.Unmarshal(e.Data, &v)
		return fmt.Sprintf("%s [%s] ← %d %s %s", t, e.Source, v.Status, v.MimeType, trim(v.URL, 100))
	case events.KindNetworkFailed:
		var v events.NetworkFailed
		_ = json.Unmarshal(e.Data, &v)
		return fmt.Sprintf("%s [%s] ✗ %s %s", t, e.Source, v.RequestID, v.ErrorText)
	case events.KindConsole, events.KindLog, events.KindException:
		var v events.ConsoleEntry
		_ = json.Unmarshal(e.Data, &v)
		return fmt.Sprintf("%s [%s] %s %s: %s", t, e.Source, e.Kind, strings.ToUpper(v.Level), v.Text)
	case events.KindPerfMonitor:
		var v events.PerfMonitorSample
		_ = json.Unmarshal(e.Data, &v)
		keys := []string{"JSHeapUsedSize", "Nodes", "LayoutCount", "RecalcStyleCount", "ScriptDuration", "TaskDuration"}
		out := make([]string, 0, len(keys))
		for _, k := range keys {
			if val, ok := v.Metrics[k]; ok {
				out = append(out, fmt.Sprintf("%s=%.2f", k, val))
			}
		}
		return fmt.Sprintf("%s [%s] perf %s", t, e.Source, strings.Join(out, " "))
	case events.KindLifecycle:
		var v events.Lifecycle
		_ = json.Unmarshal(e.Data, &v)
		return fmt.Sprintf("%s [%s] lifecycle %s", t, e.Source, v.Name)
	case events.KindNavigated:
		var v events.Navigated
		_ = json.Unmarshal(e.Data, &v)
		return fmt.Sprintf("%s [%s] navigated %s", t, e.Source, v.URL)
	case events.KindMeta:
		var v events.Meta
		_ = json.Unmarshal(e.Data, &v)
		return fmt.Sprintf("%s [%s] meta %s %v", t, e.Source, v.Message, v.Extra)
	}
	return fmt.Sprintf("%s [%s] %s %s", t, e.Source, e.Kind, string(e.Data))
}

func trim(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
