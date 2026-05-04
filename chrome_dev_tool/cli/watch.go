package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/browser"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/collector"
	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/events"
)

func newWatchCmd() *cobra.Command {
	var (
		host        string
		port        int
		index       int
		navigate    string
		headless    bool
		launchURL   string
		execPath    string
		noNetwork   bool
		noConsole   bool
		noPerf      bool
		perfMs      int
	)
	cmd := &cobra.Command{
		Use:   "watch",
		Short: "Attach to a Chromium target and stream events as NDJSON to stdout",
		Long: `If --port is set, watch attaches to an existing Chromium debug endpoint.
If --port is omitted, watch launches a Chromium (downloading one if needed),
then attaches. Each event is written to stdout as one JSON line.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer cancel()

			var proc *browser.Process
			if port == 0 {
				p, err := browser.Launch(ctx, browser.LaunchOptions{
					ExecPath: execPath,
					Headless: headless,
					URL:      launchURL,
				})
				if err != nil {
					return fmt.Errorf("launch chromium: %w", err)
				}
				proc = p
				host = "127.0.0.1"
				port = p.Port
				fmt.Fprintf(os.Stderr, "launched %s on :%d\n", p.Binary(), p.Port)
				defer proc.Stop()
			}
			if host == "" {
				host = "127.0.0.1"
			}

			c := collector.New(collector.Options{
				Host:          host,
				Port:          port,
				TargetIndex:   index,
				NavigateURL:   navigate,
				EnableNetwork: !noNetwork,
				EnableConsole: !noConsole,
				EnablePerf:    !noPerf,
				PerfInterval:  time.Duration(perfMs) * time.Millisecond,
			})
			enc := json.NewEncoder(os.Stdout)
			sink := collector.SinkFunc(func(e events.Event) { _ = enc.Encode(e) })

			startCtx, startCancel := context.WithTimeout(ctx, 15*time.Second)
			err := c.Start(startCtx, sink)
			startCancel()
			if err != nil {
				return err
			}
			defer c.Stop()
			<-ctx.Done()
			return nil
		},
	}
	cmd.Flags().StringVar(&host, "host", "127.0.0.1", "CDP host")
	cmd.Flags().IntVar(&port, "port", 0, "CDP port (0 → launch chromium)")
	cmd.Flags().IntVar(&index, "target-index", 0, "page target index from /json")
	cmd.Flags().StringVar(&navigate, "navigate", "", "navigate to URL after attach")
	cmd.Flags().BoolVar(&headless, "headless", false, "launch headless when launching chromium")
	cmd.Flags().StringVar(&launchURL, "url", "about:blank", "URL to open when launching chromium")
	cmd.Flags().StringVar(&execPath, "chromium", "", "explicit chromium binary path (auto-detect when empty)")
	cmd.Flags().BoolVar(&noNetwork, "no-network", false, "disable Network domain")
	cmd.Flags().BoolVar(&noConsole, "no-console", false, "disable Console / Log / Exception")
	cmd.Flags().BoolVar(&noPerf, "no-perf", false, "disable Performance polling")
	cmd.Flags().IntVar(&perfMs, "perf-interval-ms", 1000, "Performance.getMetrics polling interval (ms)")
	return cmd
}
