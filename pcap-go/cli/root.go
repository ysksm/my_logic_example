// Package cli wires the cobra commands for pcap-go.
package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/ysksm/my_logic_example/pcap-go/core"
)

var (
	rootCmd = &cobra.Command{
		Use:   "pcap-go",
		Short: "macOS-friendly packet capture toolkit (CLI + Web)",
		Long: "pcap-go captures network traffic via libpcap on macOS/Linux.\n" +
			"Commands:\n" +
			"  list      list capturable interfaces\n" +
			"  capture   stream packets from an interface to stdout\n" +
			"  serve     start the Web UI / REST API",
	}

	manager *core.Manager
)

// Execute runs the root cobra command.
func Execute(version string) {
	rootCmd.Version = version
	manager = core.NewManager(core.NewCapturer())

	rootCmd.AddCommand(listCmd, captureCmd, serveCmd)

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
