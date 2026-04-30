// Command desktop launches the ticket-manager UI inside a native Wails
// window. Build with `-tags dev` (development) or `-tags production` to
// include the Wails runtime; the default build emits a stub that explains
// how to rebuild.
//
// The desktop binary is fully self-contained: it does not start any TCP
// server. The frontend's fetch("/api/...") calls are routed in-process
// through Wails' AssetServer.Handler (the same chi router the web build
// uses). The default database is a DuckDB file under the OS user data
// directory so the app works regardless of the current working directory.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/app"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/desktop"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

const appDirName = "ticket-manager"

func main() {
	defaultDriver := envOr("DB_DRIVER", "duckdb")
	defaultDSN := envOr("DB_DSN", defaultDesktopDBPath())
	driverFlag := flag.String("db-driver", defaultDriver, "DB driver: duckdb | sqlite | postgres | mysql")
	dsnFlag := flag.String("db", defaultDSN, "DB connection string")
	flag.Parse()

	driver, err := dbx.ParseDriver(*driverFlag)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// Ensure the parent directory exists for file-based drivers.
	if driver == dbx.DriverDuckDB || driver == dbx.DriverSQLite {
		if dir := filepath.Dir(*dsnFlag); dir != "." && dir != "" {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				log.Fatalf("create data dir %s: %v", dir, err)
			}
		}
	}

	fmt.Println()
	fmt.Println("  ticket-manager (desktop) starting")
	fmt.Println("    Driver  :", driver)
	fmt.Println("    DSN     :", *dsnFlag)
	fmt.Println("    No TCP server is opened; the frontend talks to the chi")
	fmt.Println("    router in-process via Wails' AssetServer.")
	fmt.Println()

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

// defaultDesktopDBPath picks a sensible per-user location for the embedded
// DuckDB file. Falls back to a relative path if the OS does not report a
// config directory.
//
//	macOS:   ~/Library/Application Support/ticket-manager/ticket-manager.duckdb
//	Linux:   ~/.config/ticket-manager/ticket-manager.duckdb
//	Windows: %APPDATA%/ticket-manager/ticket-manager.duckdb
func defaultDesktopDBPath() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		return "ticket-manager.duckdb"
	}
	return filepath.Join(dir, appDirName, "ticket-manager.duckdb")
}
