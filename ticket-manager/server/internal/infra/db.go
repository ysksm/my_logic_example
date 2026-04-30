package infra

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"time"

	mysqldrv "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/marcboeker/go-duckdb"
	_ "modernc.org/sqlite"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

//go:embed all:migrations
var migrationsFS embed.FS

// OpenDB opens a database connection for the given driver.
//
//   - duckdb:   dsn is a file path (or ":memory:")
//   - sqlite:   dsn is a file path (or ":memory:")
//   - postgres: dsn is a libpq URL or keyword string (e.g. "postgres://u:p@host/db?sslmode=disable")
//   - mysql:    dsn is a go-sql-driver/mysql DSN (e.g. "user:pass@tcp(host:3306)/db")
//
// MySQL DSNs automatically have parseTime=true applied so that DATETIME / DATE
// columns scan into time.Time.
func OpenDB(driver dbx.Driver, dsn string) (*dbx.DB, error) {
	if !driverValid(driver) {
		return nil, fmt.Errorf("unsupported driver %q", driver)
	}
	dsn, err := normalizeDSN(driver, dsn)
	if err != nil {
		return nil, err
	}
	raw, err := sql.Open(driver.SQLDriverName(), dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", driver, err)
	}
	if driver == dbx.DriverDuckDB {
		// DuckDB is single-writer; keep the pool small to avoid contention.
		raw.SetMaxOpenConns(1)
	}
	if err := raw.Ping(); err != nil {
		raw.Close()
		return nil, fmt.Errorf("ping %s: %w", driver, err)
	}
	return dbx.New(raw, driver), nil
}

func driverValid(d dbx.Driver) bool {
	switch d {
	case dbx.DriverDuckDB, dbx.DriverSQLite, dbx.DriverPostgres, dbx.DriverMySQL:
		return true
	}
	return false
}

func normalizeDSN(driver dbx.Driver, dsn string) (string, error) {
	switch driver {
	case dbx.DriverDuckDB:
		// go-duckdb >=1.8 parses the DSN as a URL; ":memory:" trips that up,
		// so translate it to the empty DSN that opens an in-memory database.
		if dsn == ":memory:" {
			return "", nil
		}
		return dsn, nil
	case dbx.DriverMySQL:
		cfg, err := mysqldrv.ParseDSN(dsn)
		if err != nil {
			return "", fmt.Errorf("parse mysql dsn: %w", err)
		}
		cfg.ParseTime = true
		return cfg.FormatDSN(), nil
	default:
		return dsn, nil
	}
}

// Migrate applies any pending migrations from migrations/<driver>/ in the
// embedded filesystem. Already-applied migrations are recorded in the
// schema_migrations table and skipped on subsequent startups.
func Migrate(db *dbx.DB) error {
	ctx := context.Background()
	if err := ensureMigrationsTable(ctx, db); err != nil {
		return err
	}
	applied, err := loadAppliedMigrations(ctx, db)
	if err != nil {
		return err
	}
	subdir := "migrations/" + string(db.Driver)
	entries, err := fs.ReadDir(migrationsFS, subdir)
	if err != nil {
		return fmt.Errorf("read %s: %w", subdir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, n := range names {
		if applied[n] {
			continue
		}
		body, err := fs.ReadFile(migrationsFS, subdir+"/"+n)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", n, err)
		}
		if _, err := db.DB.ExecContext(ctx, string(body)); err != nil {
			return fmt.Errorf("apply migration %s: %w", n, err)
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
			n, time.Now().UTC()); err != nil {
			return fmt.Errorf("record migration %s: %w", n, err)
		}
	}
	return nil
}

func ensureMigrationsTable(ctx context.Context, db *dbx.DB) error {
	var ddl string
	switch db.Driver {
	case dbx.DriverMySQL:
		ddl = `CREATE TABLE IF NOT EXISTS schema_migrations (
            name VARCHAR(255) NOT NULL PRIMARY KEY,
            applied_at DATETIME NOT NULL
        ) DEFAULT CHARSET=utf8mb4`
	default:
		ddl = `CREATE TABLE IF NOT EXISTS schema_migrations (
            name VARCHAR(255) NOT NULL PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL
        )`
	}
	if _, err := db.DB.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	return nil
}

func loadAppliedMigrations(ctx context.Context, db *dbx.DB) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, `SELECT name FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("query schema_migrations: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out[n] = true
	}
	return out, rows.Err()
}
