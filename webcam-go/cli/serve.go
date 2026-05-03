package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/ysksm/my_logic_example/webcam-go/web"
)

var serveAddr string

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the Web UI and REST/MJPEG/WebSocket server",
	RunE: func(cmd *cobra.Command, args []string) error {
		srv := web.NewServer(manager)

		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
		go func() {
			<-sigCh
			fmt.Fprintln(os.Stderr, "shutting down...")
			ctxShutdown, c := context.WithTimeout(context.Background(), 3*time.Second)
			defer c()
			_ = srv.Shutdown(ctxShutdown)
		}()

		fmt.Fprintf(os.Stderr, "webcam-go listening on http://%s\n", displayAddr(serveAddr))
		return srv.ListenAndServe(serveAddr)
	},
}

func init() {
	serveCmd.Flags().StringVar(&serveAddr, "addr", ":8080", "HTTP listen address")
}

func displayAddr(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return "localhost" + addr
	}
	return addr
}
