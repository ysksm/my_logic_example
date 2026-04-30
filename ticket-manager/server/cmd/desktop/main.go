// Command desktop launches the ticket-manager UI inside a native Wails
// window. Build with `-tags dev` (development) or `-tags production` to
// include the Wails runtime; the default build emits a stub that explains
// how to rebuild.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/app"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/desktop"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

func main() {
	defaultDriver := envOr("DB_DRIVER", "duckdb")
	defaultDSN := envOr("DB_DSN", "ticket-manager.duckdb")
	driverFlag := flag.String("db-driver", defaultDriver, "DB driver: duckdb | sqlite | postgres | mysql")
	dsnFlag := flag.String("db", defaultDSN, "DB connection string")
	flag.Parse()

	driver, err := dbx.ParseDriver(*driverFlag)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	fmt.Printf("ticket-manager (desktop) starting (driver=%s dsn=%s)\n", driver, *dsnFlag)
	if err := desktop.Run(app.Config{
		Driver:           driver,
		DSN:              *dsnFlag,
		MaintenanceToken: os.Getenv("MAINTENANCE_TOKEN"),
	}); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
