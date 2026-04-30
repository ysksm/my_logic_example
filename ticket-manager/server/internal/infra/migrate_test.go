package infra

import (
	"context"
	"testing"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

// Smoke-test that migrations apply cleanly against the embedded drivers and
// are idempotent across re-invocations. PostgreSQL and MySQL require live
// servers and are not exercised here; their migration SQL is exercised by
// linting on file load (the embedded FS is read at startup).
func TestMigrate_DuckDBInMemory(t *testing.T) {
	db, err := OpenDB(dbx.DriverDuckDB, ":memory:")
	if err != nil {
		t.Fatalf("open duckdb: %v", err)
	}
	defer db.Close()
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate (re-run): %v", err)
	}
	assertTableExists(t, db, "tickets")
	assertTableExists(t, db, "schema_migrations")
	assertColumnExists(t, db, "time_entries", "user_name")
}

func TestMigrate_SQLiteInMemory(t *testing.T) {
	db, err := OpenDB(dbx.DriverSQLite, ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate (re-run): %v", err)
	}
	assertTableExists(t, db, "tickets")
	assertTableExists(t, db, "schema_migrations")
	assertColumnExists(t, db, "time_entries", "user_name")
}

func assertTableExists(t *testing.T, db *dbx.DB, name string) {
	t.Helper()
	rows, err := db.QueryContext(context.Background(), dbx.ListTablesQuery(db.Driver))
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n == name {
			return
		}
	}
	t.Fatalf("table %q not found", name)
}

func assertColumnExists(t *testing.T, db *dbx.DB, table, col string) {
	t.Helper()
	q := "SELECT " + col + " FROM " + table + " WHERE 1 = 0"
	if _, err := db.QueryContext(context.Background(), q); err != nil {
		t.Fatalf("column %s.%s not selectable: %v", table, col, err)
	}
}
