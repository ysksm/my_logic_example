package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
)

func newListCmd() *cobra.Command {
	var host string
	var port int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List CDP page targets at host:port (Chromium must already be running with --remote-debugging-port)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if port == 0 {
				return fmt.Errorf("--port is required (start chromium first, e.g. with `cdt watch`)")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			targets, err := cdp.ListTargets(ctx, host, port)
			if err != nil {
				return err
			}
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(targets)
		},
	}
	cmd.Flags().StringVar(&host, "host", "127.0.0.1", "CDP host")
	cmd.Flags().IntVar(&port, "port", 0, "CDP port")
	return cmd
}
