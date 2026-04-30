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
	"github.com/ysksm/jd-go/core"
	"github.com/ysksm/jd-go/web"
)

// App is the Wails desktop application wrapper.
type App struct {
	ctx    context.Context
	server *web.Server
}

// Run creates and starts the Wails desktop application.
func Run(cfg core.Config) error {
	server, err := web.NewServer(cfg)
	if err != nil {
		return fmt.Errorf("create server: %w", err)
	}

	app := &App{
		server: server,
	}

	return wails.Run(&options.App{
		Title:     "JD-Go - Jira Dashboard",
		Width:     1280,
		Height:    800,
		MinWidth:  800,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Handler: server.Handler(),
		},
		OnStartup: func(ctx context.Context) {
			app.ctx = ctx
		},
		OnShutdown: func(ctx context.Context) {
			server.Close()
		},
		Bind: []interface{}{
			app,
		},
	})
}
