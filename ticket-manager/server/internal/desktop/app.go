//go:build dev || production

// Package desktop wraps the ticket-manager backend in a Wails v2 window.
// Built only when the `dev` or `production` build tag is set so the default
// `go build` (used by the web server) does not pull in the Wails toolchain.
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

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/app"
)

// Bridge is bound into the Wails runtime so the frontend can call backend
// methods directly via `window.go.desktop.Bridge.*`. It also keeps a
// reference to the underlying app for cleanup.
type Bridge struct {
	ctx context.Context
	a   *app.App
}

// Version exposes a trivial method so the bind step has at least one method
// to register; the UI itself talks to the chi router via the AssetServer.
func (b *Bridge) Version() string { return "ticket-manager desktop" }

// Run starts the Wails desktop window backed by the same chi handler the
// web server uses.
func Run(cfg app.Config) error {
	a, err := app.New(cfg)
	if err != nil {
		return fmt.Errorf("init app: %w", err)
	}

	bridge := &Bridge{a: a}

	return wails.Run(&options.App{
		Title:     "Ticket Manager",
		Width:     1280,
		Height:    800,
		MinWidth:  800,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Handler: a.Handler(),
		},
		OnStartup: func(ctx context.Context) {
			bridge.ctx = ctx
		},
		OnShutdown: func(ctx context.Context) {
			_ = a.Close()
		},
		Bind: []interface{}{bridge},
	})
}
