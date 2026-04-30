package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/git"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/handler"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/maintenance"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/repository"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/service"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/webui"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dbPath := flag.String("db", "ticket-manager.duckdb", "DuckDB file path or ':memory:'")
	flag.Parse()

	maintToken := os.Getenv("MAINTENANCE_TOKEN")

	db, err := infra.OpenDB(*dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := infra.Migrate(db, ""); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	ticketRepo := repository.NewTicketRepository(db)
	timeRepo := repository.NewTimeEntryRepository(db)
	calRepo := repository.NewCalendarRepository(db)
	repoRepo := repository.NewRepoRepository(db)

	gitClient := git.New()

	h := &handler.Handlers{
		Tickets: service.NewTicketService(ticketRepo),
		Times:   service.NewTimeEntryService(timeRepo),
		Cal:     service.NewCalendarService(calRepo),
		Repos:   service.NewRepositoryService(repoRepo, gitClient),
		Maint:   maintenance.New(db, maintToken),
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

	log.Printf("ticket-manager listening on %s (db=%s)", *addr, *dbPath)
	if err := http.ListenAndServe(*addr, r); err != nil {
		log.Fatal(err)
	}
}
