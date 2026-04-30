package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
)

type TimeEntryRepository struct {
	db *sql.DB
}

func NewTimeEntryRepository(db *sql.DB) *TimeEntryRepository {
	return &TimeEntryRepository{db: db}
}

type TimeEntryFilter struct {
	TicketID string
	From     string
	To       string
}

func (r *TimeEntryRepository) List(ctx context.Context, f TimeEntryFilter) ([]domain.TimeEntry, error) {
	var conds []string
	var args []any
	if f.TicketID != "" {
		conds = append(conds, "te.ticket_id = ?")
		args = append(args, f.TicketID)
	}
	if f.From != "" {
		conds = append(conds, "te.work_date >= CAST(? AS DATE)")
		args = append(args, f.From)
	}
	if f.To != "" {
		conds = append(conds, "te.work_date <= CAST(? AS DATE)")
		args = append(args, f.To)
	}
	q := `SELECT te.id, te.ticket_id, COALESCE(t.title, ''), te."user", te.hours, te.work_date, te.note, te.created_at
          FROM time_entries te LEFT JOIN tickets t ON t.id = te.ticket_id`
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += " ORDER BY te.work_date DESC, te.created_at DESC"

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query time_entries: %w", err)
	}
	defer rows.Close()
	out := []domain.TimeEntry{}
	for rows.Next() {
		var e domain.TimeEntry
		var workDate time.Time
		if err := rows.Scan(&e.ID, &e.TicketID, &e.TicketTitle, &e.User, &e.Hours, &workDate, &e.Note, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.WorkDate = workDate.Format("2006-01-02")
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *TimeEntryRepository) Create(ctx context.Context, e *domain.TimeEntry) error {
	e.CreatedAt = time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO time_entries (id, ticket_id, "user", hours, work_date, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.TicketID, e.User, e.Hours, e.WorkDate, e.Note, e.CreatedAt,
	)
	return err
}

func (r *TimeEntryRepository) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM time_entries WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
