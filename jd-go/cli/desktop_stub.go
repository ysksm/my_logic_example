//go:build !dev && !production

package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var desktopCmd = &cobra.Command{
	Use:   "desktop",
	Short: "Start the desktop application (Wails) - requires build tag: -tags dev",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Fprintln(os.Stderr, "Error: desktop mode is not available in this build.")
		fmt.Fprintln(os.Stderr, "Rebuild with: go build -tags dev")
		os.Exit(1)
	},
}
