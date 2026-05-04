//go:build !wails

package cli

import "github.com/spf13/cobra"

// newDesktopCmd is the no-Wails default. It surfaces the command in --help
// but tells the user to rebuild with -tags wails when invoked.
func newDesktopCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "desktop",
		Short: "Run as a Wails desktop app (rebuild with `go build -tags wails`)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return errDesktopRequiresWails
		},
		Hidden: true,
	}
}

var errDesktopRequiresWails = errString("desktop mode requires building with `-tags wails`")

type errString string

func (e errString) Error() string { return string(e) }
