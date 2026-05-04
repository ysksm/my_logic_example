//go:build wails

package cli

import "github.com/spf13/cobra"

// newDesktopCmd is the Wails entry point. The wails build tag selects this
// file so the default `go build` keeps no Wails dependency.
func newDesktopCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "desktop",
		Short: "Run as a Wails desktop app (build with -tags wails)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runWailsApp()
		},
	}
}

// runWailsApp is provided by the desktop/ package once Wails is wired up.
// For now this returns a clear error so the build still passes.
func runWailsApp() error {
	return errWailsNotImplemented
}

var errWailsNotImplemented = wailsErr("desktop mode is reserved; wire up github.com/wailsapp/wails/v2 in desktop/ to enable it")

type wailsErr string

func (e wailsErr) Error() string { return string(e) }
