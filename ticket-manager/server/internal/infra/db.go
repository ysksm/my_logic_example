package infra

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"

	_ "github.com/marcboeker/go-duckdb"
)

//go:embed all:migrations
var migrationsFS embed.FS

// OpenDB opens a DuckDB database file (or :memory:).
func OpenDB(path string) (*sql.DB, error) {
	db, err := sql.Open("duckdb", path)
	if err != nil {
		return nil, fmt.Errorf("open duckdb: %w", err)
	}
	db.SetMaxOpenConns(1) // DuckDB single-writer; keep simple
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping duckdb: %w", err)
	}
	return db, nil
}

// Migrate runs all migrations under the migrations directory.
// migrationsDir is a path relative to the server module root, but since we
// embed via the embed.FS, this argument is currently unused; embed is the
// source of truth.
func Migrate(db *sql.DB, _ string) error {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, n := range names {
		b, err := fs.ReadFile(migrationsFS, "migrations/"+n)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", n, err)
		}
		if _, err := db.Exec(string(b)); err != nil {
			return fmt.Errorf("apply migration %s: %w", n, err)
		}
	}
	return nil
}
