package main

import (
	"flag"
	"fmt"
	"log"
	"net"
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

	url := accessURL(*addr)
	fmt.Println()
	fmt.Println("  ticket-manager is running.")
	fmt.Println()
	fmt.Println("  ▶ Open in your browser :", url)
	fmt.Println("    Health check         :", url+"/api/health")
	fmt.Println("    DB                   :", *dbPath)
	fmt.Println("    Stop                 : Ctrl-C")
	fmt.Println()

	log.Printf("ticket-manager listening on %s (db=%s)", *addr, *dbPath)
	if err := http.ListenAndServe(*addr, r); err != nil {
		log.Fatal(err)
	}
}

// accessURL turns a listen address (e.g. ":8080", "0.0.0.0:8080",
// "127.0.0.1:8080") into a URL that a developer can open in a browser.
func accessURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://" + addr
	}
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		host = "localhost"
	}
	return fmt.Sprintf("http://%s:%s", host, port)
}
