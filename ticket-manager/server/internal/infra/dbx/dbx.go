// Package dbx wraps *sql.DB with a known SQL dialect so that repository code
// can be written once with `?` placeholders and have it work across DuckDB,
// SQLite, PostgreSQL and MySQL.
package dbx

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// Driver identifies a supported backend database.
type Driver string

const (
	DriverDuckDB   Driver = "duckdb"
	DriverSQLite   Driver = "sqlite"
	DriverPostgres Driver = "postgres"
	DriverMySQL    Driver = "mysql"
)

// ParseDriver normalises and validates a driver name from configuration.
func ParseDriver(s string) (Driver, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "duckdb":
		return DriverDuckDB, nil
	case "sqlite", "sqlite3":
		return DriverSQLite, nil
	case "postgres", "postgresql", "pgx":
		return DriverPostgres, nil
	case "mysql", "mariadb":
		return DriverMySQL, nil
	}
	return "", fmt.Errorf("unsupported DB driver: %q (expected duckdb|sqlite|postgres|mysql)", s)
}

// SQLDriverName returns the database/sql driver name registered by the
// imported driver package for this Driver.
func (d Driver) SQLDriverName() string {
	switch d {
	case DriverDuckDB:
		return "duckdb"
	case DriverSQLite:
		return "sqlite"
	case DriverPostgres:
		return "pgx"
	case DriverMySQL:
		return "mysql"
	}
	return ""
}

// DB is a thin wrapper around *sql.DB that rewrites SQL on the fly so the
// same query string works across all supported drivers.
type DB struct {
	*sql.DB
	Driver Driver
}

// New wraps an already-opened *sql.DB.
func New(raw *sql.DB, d Driver) *DB { return &DB{DB: raw, Driver: d} }

// Rewrite adapts a `?`-placeholder SQL string to the driver's expected style.
// PostgreSQL gets `$1, $2, ...` placeholders. Other drivers are returned
// unchanged.
func (d *DB) Rewrite(q string) string { return rewrite(d.Driver, q) }

// ExecContext / QueryContext / QueryRowContext mirror database/sql but
// transparently rewrite the SQL for the active driver.
func (d *DB) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return d.DB.ExecContext(ctx, rewrite(d.Driver, q), args...)
}

func (d *DB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return d.DB.QueryContext(ctx, rewrite(d.Driver, q), args...)
}

func (d *DB) QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row {
	return d.DB.QueryRowContext(ctx, rewrite(d.Driver, q), args...)
}

// BeginTx starts a transaction whose Exec/Query/QueryRow methods perform the
// same rewriting as the parent DB.
func (d *DB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := d.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, Driver: d.Driver}, nil
}

// Tx wraps *sql.Tx with dialect-aware rewriting.
type Tx struct {
	*sql.Tx
	Driver Driver
}

func (t *Tx) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return t.Tx.ExecContext(ctx, rewrite(t.Driver, q), args...)
}

func (t *Tx) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return t.Tx.QueryContext(ctx, rewrite(t.Driver, q), args...)
}

func (t *Tx) QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row {
	return t.Tx.QueryRowContext(ctx, rewrite(t.Driver, q), args...)
}

// rewrite applies driver-specific SQL transformations.
//
//   - SQLite:    `CAST(? AS DATE)` -> `?` (SQLite stores dates as ISO-8601 TEXT
//                so the CAST is unnecessary and would yield a numeric value).
//   - PostgreSQL: `?` -> `$N` (skipping characters inside string literals).
func rewrite(d Driver, q string) string {
	if d == DriverSQLite {
		q = strings.ReplaceAll(q, "CAST(? AS DATE)", "?")
	}
	if d == DriverPostgres {
		q = rewritePlaceholders(q)
	}
	return q
}

func rewritePlaceholders(q string) string {
	var b strings.Builder
	b.Grow(len(q) + 8)
	n := 0
	inSingle := false
	for i := 0; i < len(q); i++ {
		c := q[i]
		switch {
		case c == '\'':
			// Handle '' escape inside string literals.
			b.WriteByte(c)
			if inSingle && i+1 < len(q) && q[i+1] == '\'' {
				b.WriteByte('\'')
				i++
				continue
			}
			inSingle = !inSingle
		case c == '?' && !inSingle:
			n++
			fmt.Fprintf(&b, "$%d", n)
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

// OnConflictDoNothing returns the suffix that turns an INSERT statement into
// an idempotent insert for the active driver.
//
//	driver=mysql:                returns "" and the caller must rewrite the
//	                             leading "INSERT INTO" via InsertVerb (MySQL
//	                             uses "INSERT IGNORE INTO" instead).
//	driver=duckdb|sqlite|pg:     returns " ON CONFLICT (col,..) DO NOTHING"
//	                             (or " ON CONFLICT DO NOTHING" if no cols).
func OnConflictDoNothing(d Driver, conflictCols ...string) string {
	if d == DriverMySQL {
		return ""
	}
	if len(conflictCols) == 0 {
		return " ON CONFLICT DO NOTHING"
	}
	return " ON CONFLICT (" + strings.Join(conflictCols, ", ") + ") DO NOTHING"
}

// InsertVerb returns the INSERT keyword for an idempotent insert. MySQL needs
// "INSERT IGNORE" since it does not support ON CONFLICT clauses; other drivers
// use the standard "INSERT".
func InsertVerb(d Driver) string {
	if d == DriverMySQL {
		return "INSERT IGNORE"
	}
	return "INSERT"
}

// ListTablesQuery returns a driver-appropriate query that lists the names of
// all user tables in the current database/schema. Each driver's metadata
// catalog has different conventions; this isolates that knowledge.
func ListTablesQuery(d Driver) string {
	switch d {
	case DriverDuckDB:
		return `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`
	case DriverSQLite:
		return `SELECT name AS table_name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
	case DriverPostgres:
		return `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
	case DriverMySQL:
		return `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`
	}
	return ""
}
