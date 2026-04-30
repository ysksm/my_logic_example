//go:build dev || production

package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/ysksm/jd-go/desktop"
)

var desktopCmd = &cobra.Command{
	Use:   "desktop",
	Short: "Start the desktop application (Wails)",
	Run: func(cmd *cobra.Command, args []string) {
		if err := desktop.Run(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	},
}
