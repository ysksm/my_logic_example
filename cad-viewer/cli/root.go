package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/ysksm/my_logic_example/cad-viewer/core"
)

var (
	cfg     = core.DefaultConfig()
	version = "dev"

	rootCmd = &cobra.Command{
		Use:   "cad-viewer",
		Short: "CAD viewer (Go + Babylon.js) — web and Wails desktop",
		Long: `cad-viewer is a single binary that can either serve the CAD viewer
over HTTP (web mode) or open it as a Wails desktop window. The same Go
backend, the same Babylon.js frontend, two delivery surfaces.`,
		Version: "",
	}
)

// Execute is the program entry point invoked from main.go.
func Execute(v string) {
	version = v
	rootCmd.Version = v
	rootCmd.AddCommand(serveCmd, desktopCmd)
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
