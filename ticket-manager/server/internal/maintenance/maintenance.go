package maintenance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

var ErrDisabled = errors.New("maintenance mode is disabled")

// Mode tracks whether the server is in maintenance mode and exposes
// raw DB inspection helpers for use only when enabled.
type Mode struct {
	enabled atomic.Bool
	token   string // optional shared secret for enable
	db      *dbx.DB
}

func New(db *dbx.DB, token string) *Mode {
	return &Mode{db: db, token: token}
}

func (m *Mode) Enabled() bool       { return m.enabled.Load() }
func (m *Mode) ExpectedToken() bool { return m.token != "" }

func (m *Mode) Enable(token string) error {
	if m.token != "" && token != m.token {
		return errors.New("invalid maintenance token")
	}
	m.enabled.Store(true)
	return nil
}

func (m *Mode) Disable() { m.enabled.Store(false) }

func (m *Mode) requireEnabled() error {
	if !m.enabled.Load() {
		return ErrDisabled
	}
	return nil
}

func (m *Mode) Tables(ctx context.Context) ([]string, error) {
	if err := m.requireEnabled(); err != nil {
		return nil, err
	}
	rows, err := m.db.QueryContext(ctx, dbx.ListTablesQuery(m.db.Driver))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

type Dump struct {
	Columns  []string `json:"columns"`
	Rows     [][]any  `json:"rows"`
	RowCount int      `json:"row_count"`
}

// DumpTable returns the contents of a single table. The table name is
// validated against the live information_schema list to avoid SQL injection
// since it cannot be parameterized.
func (m *Mode) DumpTable(ctx context.Context, name string, limit int) (*Dump, error) {
	if err := m.requireEnabled(); err != nil {
		return nil, err
	}
	if !validIdentifier(name) {
		return nil, fmt.Errorf("invalid table name")
	}
	tables, err := m.Tables(ctx)
	if err != nil {
		return nil, err
	}
	allowed := false
	for _, t := range tables {
		if t == name {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, fmt.Errorf("unknown table: %s", name)
	}
	if limit <= 0 || limit > 5000 {
		limit = 200
	}
	q := fmt.Sprintf(`SELECT * FROM %s LIMIT %d`, quoteIdent(m.db.Driver, name), limit)
	return m.runQuery(ctx, q)
}

// Query runs an arbitrary SQL string. Only allowed in maintenance mode.
// Multi-statement and DDL/DML are permitted intentionally; this is a
// developer/operator escape hatch, not a public surface.
func (m *Mode) Query(ctx context.Context, sqlText string) (*Dump, error) {
	if err := m.requireEnabled(); err != nil {
		return nil, err
	}
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, errors.New("empty sql")
	}
	return m.runQuery(ctx, sqlText)
}

func (m *Mode) runQuery(ctx context.Context, q string) (*Dump, error) {
	rows, err := m.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	dump := &Dump{Columns: cols, Rows: [][]any{}}
	for rows.Next() {
		buf := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range buf {
			ptrs[i] = &buf[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make([]any, len(cols))
		for i, v := range buf {
			row[i] = normalizeValue(v)
		}
		dump.Rows = append(dump.Rows, row)
	}
	dump.RowCount = len(dump.Rows)
	return dump, rows.Err()
}

func normalizeValue(v any) any {
	switch x := v.(type) {
	case []byte:
		return string(x)
	default:
		return x
	}
}

// quoteIdent quotes a previously-validated identifier for the active driver.
// MySQL requires backticks; the others accept ANSI double quotes.
func quoteIdent(d dbx.Driver, name string) string {
	if d == dbx.DriverMySQL {
		return "`" + name + "`"
	}
	return `"` + name + `"`
}

func validIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_':
		default:
			return false
		}
	}
	return true
}
