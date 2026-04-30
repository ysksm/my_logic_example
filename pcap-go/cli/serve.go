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
	"github.com/ysksm/my_logic_example/pcap-go/web"
)

var (
	serveAddr string
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the Web UI and REST/WebSocket API",
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

		fmt.Fprintf(os.Stderr, "pcap-go listening on http://%s\n", displayAddr(serveAddr))
		return srv.ListenAndServe(serveAddr)
	},
}

func init() {
	serveCmd.Flags().StringVar(&serveAddr, "addr", ":8080", "HTTP listen address")
}

// displayAddr makes the listen address human-friendly. When the host is empty
// (e.g. ":8080" — listen on all interfaces), prefix "localhost" so the printed
// URL is clickable.
func displayAddr(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return "localhost" + addr
	}
	return addr
}
