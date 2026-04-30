package repository

import (
	"context"
	"testing"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

// Exercise create / list / get / tag / update / delete on each embedded
// driver to catch dialect-specific SQL regressions. PostgreSQL and MySQL need
// live servers and are intentionally not covered here.
func TestTicketRepository_CRUD(t *testing.T) {
	for _, tc := range []struct {
		name   string
		driver dbx.Driver
		dsn    string
	}{
		{"duckdb", dbx.DriverDuckDB, ":memory:"},
		{"sqlite", dbx.DriverSQLite, ":memory:"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, err := infra.OpenDB(tc.driver, tc.dsn)
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			defer db.Close()
			if err := infra.Migrate(db); err != nil {
				t.Fatalf("migrate: %v", err)
			}
			repo := NewTicketRepository(db)
			ctx := context.Background()

			tk := &domain.Ticket{
				ID: "t1", Title: "Hello", Description: "d",
				Type: domain.TicketTypeTask, Status: domain.TicketStatusTodo,
			}
			if err := repo.Create(ctx, tk, []string{"tag-a", "tag-b"}); err != nil {
				t.Fatalf("create: %v", err)
			}

			got, err := repo.Get(ctx, "t1")
			if err != nil {
				t.Fatalf("get: %v", err)
			}
			if got.Title != "Hello" {
				t.Errorf("title = %q", got.Title)
			}
			if len(got.Tags) != 2 {
				t.Errorf("tags = %v", got.Tags)
			}

			// Idempotent re-add (tests ON CONFLICT / INSERT IGNORE wiring).
			if err := repo.AddTag(ctx, "t1", "tag-a"); err != nil {
				t.Fatalf("add existing tag: %v", err)
			}

			tk.Title = "Updated"
			if err := repo.Update(ctx, tk); err != nil {
				t.Fatalf("update: %v", err)
			}

			list, err := repo.List(ctx, TicketFilter{Tag: "tag-b"})
			if err != nil {
				t.Fatalf("list: %v", err)
			}
			if len(list) != 1 || list[0].Title != "Updated" {
				t.Errorf("list = %+v", list)
			}

			if err := repo.Delete(ctx, "t1"); err != nil {
				t.Fatalf("delete: %v", err)
			}
			if _, err := repo.Get(ctx, "t1"); err != ErrNotFound {
				t.Errorf("expected ErrNotFound after delete, got %v", err)
			}
		})
	}
}
