package cli

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/web"
)

func newServeCmd() *cobra.Command {
	var addr string
	var noOpen bool
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Run the WebUI (HTTP + WebSocket + embedded React app)",
		RunE: func(cmd *cobra.Command, args []string) error {
			s := web.NewServer()
			defer s.Close()

			srv := &http.Server{Addr: addr, Handler: s.Handler()}
			ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer cancel()

			errCh := make(chan error, 1)
			go func() { errCh <- srv.ListenAndServe() }()

			fmt.Fprintf(os.Stderr, "chrome_dev_tool serving at http://%s/\n", humanAddr(addr))
			if !noOpen {
				openBrowser("http://" + humanAddr(addr) + "/")
			}

			select {
			case <-ctx.Done():
				_ = srv.Shutdown(context.Background())
			case err := <-errCh:
				if err != nil && err != http.ErrServerClosed {
					return err
				}
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&addr, "addr", ":7681", "HTTP listen address")
	cmd.Flags().BoolVar(&noOpen, "no-open", false, "do not open the default browser")
	return cmd
}

func humanAddr(addr string) string {
	if len(addr) > 0 && addr[0] == ':' {
		return "localhost" + addr
	}
	return addr
}

func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd, args = "open", []string{url}
	case "windows":
		cmd, args = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	default:
		cmd, args = "xdg-open", []string{url}
	}
	_ = exec.Command(cmd, args...).Start()
}
