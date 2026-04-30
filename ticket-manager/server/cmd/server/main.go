package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/app"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	defaultDriver := envOr("DB_DRIVER", "duckdb")
	defaultDSN := envOr("DB_DSN", "ticket-manager.duckdb")
	driverFlag := flag.String("db-driver", defaultDriver, "DB driver: duckdb | sqlite | postgres | mysql")
	dsnFlag := flag.String("db", defaultDSN, "DB connection string (file path for duckdb/sqlite, URL/DSN for postgres/mysql)")
	flag.Parse()

	driver, err := dbx.ParseDriver(*driverFlag)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	a, err := app.New(app.Config{
		Driver:           driver,
		DSN:              *dsnFlag,
		MaintenanceToken: os.Getenv("MAINTENANCE_TOKEN"),
	})
	if err != nil {
		log.Fatalf("app init: %v", err)
	}
	defer a.Close()

	url := accessURL(*addr)
	fmt.Println()
	fmt.Println("  ticket-manager is running.")
	fmt.Println()
	fmt.Println("  ▶ Open in your browser :", url)
	fmt.Println("    Health check         :", url+"/api/health")
	fmt.Println("    DB driver            :", driver)
	fmt.Println("    DB DSN               :", *dsnFlag)
	fmt.Println("    Stop                 : Ctrl-C")
	fmt.Println()

	log.Printf("ticket-manager listening on %s (driver=%s dsn=%s)", *addr, driver, *dsnFlag)
	if err := http.ListenAndServe(*addr, a.Handler()); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
