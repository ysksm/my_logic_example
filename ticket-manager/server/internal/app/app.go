// Package app wires together the ticket-manager backend so the same chi
// handler can be served by the HTTP server (cmd/server) or embedded inside
// a Wails desktop window (cmd/desktop via internal/desktop).
package app

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/git"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/handler"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/maintenance"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/repository"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/service"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/webui"
)

// Config holds runtime parameters needed to construct an App.
type Config struct {
	Driver           dbx.Driver
	DSN              string
	MaintenanceToken string
}

// App holds the open DB and the fully-mounted chi router.
type App struct {
	cfg     Config
	db      *dbx.DB
	handler http.Handler
}

// New opens the database, runs migrations, wires repositories/services and
// returns an App whose Handler is ready to serve.
func New(cfg Config) (*App, error) {
	db, err := infra.OpenDB(cfg.Driver, cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := infra.Migrate(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	ticketRepo := repository.NewTicketRepository(db)
	timeRepo := repository.NewTimeEntryRepository(db)
	calRepo := repository.NewCalendarRepository(db)
	repoRepo := repository.NewRepoRepository(db)
	sprintRepo := repository.NewSprintRepository(db)

	gitClient := git.New()

	h := &handler.Handlers{
		Tickets: service.NewTicketService(ticketRepo),
		Times:   service.NewTimeEntryService(timeRepo),
		Cal:     service.NewCalendarService(calRepo),
		Repos:   service.NewRepositoryService(repoRepo, gitClient),
		Sprints: service.NewSprintService(sprintRepo),
		Maint:   maintenance.New(db, cfg.MaintenanceToken),
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: false,
	}))

	h.Mount(r)
	r.Handle("/*", webui.Handler())

	return &App{cfg: cfg, db: db, handler: r}, nil
}

// Handler returns the HTTP handler suitable for http.ListenAndServe or for
// use as a Wails AssetServer.
func (a *App) Handler() http.Handler { return a.handler }

// Config returns the original configuration values.
func (a *App) Config() Config { return a.cfg }

// Close releases the underlying DB.
func (a *App) Close() error { return a.db.Close() }
