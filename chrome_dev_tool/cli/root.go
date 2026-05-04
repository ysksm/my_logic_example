// Package cli is the cobra entry point for `cdt`.
package cli

import "github.com/spf13/cobra"

func newRoot() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "cdt",
		Short: "Chrome DevTools Protocol observer (download → launch → attach → log/network/perf)",
		Long: `chrome_dev_tool (cdt) launches a Chromium with --remote-debugging-port,
attaches via raw CDP WebSocket and streams logs / network / performance to a
WebUI (or NDJSON / JSON on stdout for the CLI subcommands).`,
	}
	cmd.AddCommand(newServeCmd())
	cmd.AddCommand(newWatchCmd())
	cmd.AddCommand(newListCmd())
	cmd.AddCommand(newSnapshotCmd())
	cmd.AddCommand(newDesktopCmd())
	return cmd
}

// Execute runs the root command. Called by main.
func Execute() error {
	return newRoot().Execute()
}
