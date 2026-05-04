//go:build dev || production

package desktop

/*
#cgo darwin LDFLAGS: -framework UniformTypeIdentifiers
*/
import "C"

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/ysksm/my_logic_example/cad-viewer/core"
	"github.com/ysksm/my_logic_example/cad-viewer/web"
)

// App is the Wails desktop wrapper. It owns the embedded web.Server and binds
// itself so future Go-side methods can be invoked from the frontend if we
// later want to bypass HTTP for large payloads.
type App struct {
	ctx    context.Context
	server *web.Server
}

// Run boots the Wails desktop application, reusing the same HTTP routes as
// the standalone web server.
func Run(cfg core.Config) error {
	server, err := web.NewServer(cfg)
	if err != nil {
		return fmt.Errorf("create server: %w", err)
	}
	app := &App{server: server}
	return wails.Run(&options.App{
		Title:     "CAD Viewer",
		Width:     1280,
		Height:    800,
		MinWidth:  800,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Handler: server.Handler(),
		},
		OnStartup:  func(ctx context.Context) { app.ctx = ctx },
		OnShutdown: func(ctx context.Context) { _ = server.Close() },
		Bind:       []interface{}{app},
	})
}
