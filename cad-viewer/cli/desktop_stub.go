//go:build !dev && !production

package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// desktopCmd in this build configuration is a stub that explains how to
// produce a binary with desktop support. Wails pulls in cgo / OS toolchains,
// so we keep it behind build tags to keep `go build` cheap on CI / web-only
// deployments.
var desktopCmd = &cobra.Command{
	Use:   "desktop",
	Short: "Run the CAD viewer as a Wails desktop application (requires -tags dev|production)",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Fprintln(os.Stderr, "Error: desktop mode is not available in this build.")
		fmt.Fprintln(os.Stderr, "Rebuild with: go build -tags dev")
		os.Exit(1)
	},
}
