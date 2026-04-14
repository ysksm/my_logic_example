package cli

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"github.com/spf13/cobra"
	"github.com/ysksm/jd-go/web"
)

var servePort int
var serveOpen bool

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the web dashboard server",
	Run: func(cmd *cobra.Command, args []string) {
		server, err := web.NewServer(cfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		defer server.Close()

		addr := fmt.Sprintf(":%d", servePort)
		url := fmt.Sprintf("http://localhost:%d", servePort)
		fmt.Printf("Starting server at %s\n", url)

		if serveOpen {
			openBrowser(url)
		}

		if err := server.Start(addr); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	},
}

func init() {
	serveCmd.Flags().IntVar(&servePort, "port", 8080, "HTTP port")
	serveCmd.Flags().BoolVar(&serveOpen, "open", false, "Open browser automatically")
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	}
	if cmd != nil {
		cmd.Start()
	}
}
