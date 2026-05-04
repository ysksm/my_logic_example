package cli

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"time"

	"github.com/spf13/cobra"
	"github.com/ysksm/my_logic_example/cad-viewer/web"
)

var (
	serveAddr string
	serveOpen bool
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Run the CAD viewer as a web server",
	RunE: func(cmd *cobra.Command, args []string) error {
		s, err := web.NewServer(cfg)
		if err != nil {
			return err
		}
		defer s.Close()
		if serveOpen {
			go openBrowserAfter("http://"+normalizeAddr(serveAddr), 400*time.Millisecond)
		}
		return s.Start(serveAddr)
	},
}

func init() {
	serveCmd.Flags().StringVar(&serveAddr, "addr", ":8080", "listen address (host:port)")
	serveCmd.Flags().BoolVar(&serveOpen, "open", false, "open default browser after start")
}

func normalizeAddr(a string) string {
	if len(a) > 0 && a[0] == ':' {
		return "localhost" + a
	}
	return a
}

func openBrowserAfter(url string, d time.Duration) {
	time.Sleep(d)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to open browser: %v\n", err)
	}
}
