// Package cli wires the cobra commands for webcam-go.
package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/ysksm/my_logic_example/webcam-go/core"
)

var (
	rootCmd = &cobra.Command{
		Use:   "webcam-go",
		Short: "macOS-friendly webcam streaming server (CLI + Web)",
		Long: "webcam-go captures frames from a camera and serves them over\n" +
			"HTTP/MJPEG and WebSocket. On macOS the real-camera build uses\n" +
			"AVFoundation via the system ffmpeg binary; on Linux it uses v4l2.\n\n" +
			"Commands:\n" +
			"  list      list available camera devices\n" +
			"  serve     start the Web UI / REST / MJPEG / WebSocket server",
	}

	manager *core.Manager
)

// Execute runs the root cobra command.
func Execute(version string) {
	rootCmd.Version = version
	manager = core.NewManager(core.NewCamera())

	rootCmd.AddCommand(listCmd, serveCmd)

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
