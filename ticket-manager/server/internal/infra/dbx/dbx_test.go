package dbx

import "testing"

func TestRewritePlaceholders(t *testing.T) {
	cases := []struct{ in, want string }{
		{"SELECT 1", "SELECT 1"},
		{"WHERE id = ?", "WHERE id = $1"},
		{"a = ? AND b = ?", "a = $1 AND b = $2"},
		{`note = 'a?b' AND id = ?`, `note = 'a?b' AND id = $1`},
		{`note = 'it''s ?' AND id = ?`, `note = 'it''s ?' AND id = $1`},
	}
	for _, c := range cases {
		if got := rewritePlaceholders(c.in); got != c.want {
			t.Errorf("rewritePlaceholders(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestRewriteOnlyPostgres(t *testing.T) {
	for _, d := range []Driver{DriverDuckDB, DriverMySQL} {
		if got := rewrite(d, "WHERE id = ?"); got != "WHERE id = ?" {
			t.Errorf("driver %s: unexpected rewrite: %q", d, got)
		}
	}
	if got := rewrite(DriverPostgres, "WHERE id = ?"); got != "WHERE id = $1" {
		t.Errorf("postgres: %q", got)
	}
}

func TestRewriteSQLiteCastAsDate(t *testing.T) {
	q := "WHERE work_date >= CAST(? AS DATE) AND work_date <= CAST(? AS DATE)"
	got := rewrite(DriverSQLite, q)
	want := "WHERE work_date >= ? AND work_date <= ?"
	if got != want {
		t.Errorf("sqlite cast rewrite: got %q, want %q", got, want)
	}
	// Postgres should still see CAST(...) but with $N placeholders.
	got = rewrite(DriverPostgres, q)
	want = "WHERE work_date >= CAST($1 AS DATE) AND work_date <= CAST($2 AS DATE)"
	if got != want {
		t.Errorf("postgres cast: got %q, want %q", got, want)
	}
}

func TestParseDriver(t *testing.T) {
	cases := map[string]Driver{
		"":           DriverDuckDB,
		"duckdb":     DriverDuckDB,
		"sqlite":     DriverSQLite,
		"sqlite3":    DriverSQLite,
		"postgres":   DriverPostgres,
		"postgresql": DriverPostgres,
		"pgx":        DriverPostgres,
		"mysql":      DriverMySQL,
		"mariadb":    DriverMySQL,
	}
	for in, want := range cases {
		got, err := ParseDriver(in)
		if err != nil {
			t.Fatalf("ParseDriver(%q): %v", in, err)
		}
		if got != want {
			t.Errorf("ParseDriver(%q) = %s, want %s", in, got, want)
		}
	}
	if _, err := ParseDriver("oracle"); err == nil {
		t.Error("expected error for unsupported driver")
	}
}
