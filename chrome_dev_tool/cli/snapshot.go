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

func newSnapshotCmd() *cobra.Command {
	var host string
	var port int
	var index int
	cmd := &cobra.Command{
		Use:   "snapshot",
		Short: "Call Performance.getMetrics once and print the result as JSON",
		RunE: func(cmd *cobra.Command, args []string) error {
			if port == 0 {
				return fmt.Errorf("--port is required (start chromium first, e.g. with `cdt watch`)")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			cl, _, err := cdp.DialFirstPage(ctx, host, port, index)
			if err != nil {
				return err
			}
			defer cl.Close()

			if _, err := cl.Send(ctx, "Performance.enable", nil); err != nil {
				return err
			}
			raw, err := cl.Send(ctx, "Performance.getMetrics", nil)
			if err != nil {
				return err
			}
			var wrap struct {
				Metrics []struct {
					Name  string  `json:"name"`
					Value float64 `json:"value"`
				} `json:"metrics"`
			}
			if err := json.Unmarshal(raw, &wrap); err != nil {
				return err
			}
			out := map[string]float64{}
			for _, kv := range wrap.Metrics {
				out[kv.Name] = kv.Value
			}
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(map[string]any{"metrics": out})
		},
	}
	cmd.Flags().StringVar(&host, "host", "127.0.0.1", "CDP host")
	cmd.Flags().IntVar(&port, "port", 0, "CDP port")
	cmd.Flags().IntVar(&index, "target-index", 0, "page target index from /json")
	return cmd
}
