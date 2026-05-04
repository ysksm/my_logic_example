//go:build dev || production

package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/ysksm/my_logic_example/cad-viewer/desktop"
)

var desktopCmd = &cobra.Command{
	Use:   "desktop",
	Short: "Run the CAD viewer as a Wails desktop application",
	Run: func(cmd *cobra.Command, args []string) {
		if err := desktop.Run(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	},
}
