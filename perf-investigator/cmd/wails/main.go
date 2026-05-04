//go:build wails
// +build wails

// Command perf-investigator-wails is a desktop wrapper around the same Go
// hub used by the WebUI. It uses Wails v2 to host a webview pointed at an
// in-process HTTP server, so the React build runs unchanged.
//
// Build:
//
//	go install github.com/wailsapp/wails/v2/cmd/wails@latest
//	cd cmd/wails && wails build
//
// Dev:
//
//	cd cmd/wails && wails dev
//
// The build tag keeps `go build ./...` working without the wails toolchain.
package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"sync"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/recorder"
	"github.com/ysksm/my_logic_example/perf-investigator/pkg/server"
)

//go:embed all:frontend/dist
var assets embed.FS

// App is the Wails-bound application. Methods on App become callable from
// the JS side via window.go.main.App.X.
type App struct {
	ctx     context.Context
	hub     *server.Hub
	httpURL string
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	rec, err := recorder.New("./recordings", "pi")
	if err != nil {
		log.Printf("recorder: %v — continuing without disk logging", err)
	}
	a.hub = server.NewHub(rec)

	uiSub, _ := fs.Sub(assets, "frontend/dist")
	router := a.hub.Router(uiSub)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	a.httpURL = fmt.Sprintf("http://%s", listener.Addr().String())
	log.Printf("internal hub HTTP at %s", a.httpURL)

	go func() {
		if err := http.Serve(listener, router); err != nil {
			log.Printf("hub server: %v", err)
		}
	}()
}

// HubURL exposes the local hub URL so the frontend can talk to it (the
// Wails asset bundle URL is not the same origin, so we call out to the
// loopback HTTP server instead).
func (a *App) HubURL() string { return a.httpURL }

var once sync.Once

func main() {
	app := NewApp()
	if err := wails.Run(&options.App{
		Title:  "perf-investigator",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
	}); err != nil {
		log.Fatal(err)
	}
	once.Do(func() {})
}
