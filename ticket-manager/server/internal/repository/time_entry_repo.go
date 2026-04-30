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
	q := `SELECT te.id, te.ticket_id, COALESCE(t.title, ''), te."user", te.hours,
                 te.work_date, te.start_at, te.end_at, te.note, te.created_at
          FROM time_entries te LEFT JOIN tickets t ON t.id = te.ticket_id`
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += " ORDER BY te.work_date DESC, te.start_at, te.created_at DESC"

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query time_entries: %w", err)
	}
	defer rows.Close()
	out := []domain.TimeEntry{}
	for rows.Next() {
		var e domain.TimeEntry
		var ticketID sql.NullString
		var workDate time.Time
		var startAt, endAt sql.NullTime
		if err := rows.Scan(&e.ID, &ticketID, &e.TicketTitle, &e.User, &e.Hours,
			&workDate, &startAt, &endAt, &e.Note, &e.CreatedAt); err != nil {
			return nil, err
		}
		if ticketID.Valid {
			s := ticketID.String
			e.TicketID = &s
		}
		e.WorkDate = workDate.Format("2006-01-02")
		if startAt.Valid {
			t := startAt.Time
			e.StartAt = &t
		}
		if endAt.Valid {
			t := endAt.Time
			e.EndAt = &t
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *TimeEntryRepository) Get(ctx context.Context, id string) (*domain.TimeEntry, error) {
	row := r.db.QueryRowContext(ctx, `
        SELECT te.id, te.ticket_id, COALESCE(t.title, ''), te."user", te.hours,
               te.work_date, te.start_at, te.end_at, te.note, te.created_at
        FROM time_entries te LEFT JOIN tickets t ON t.id = te.ticket_id
        WHERE te.id = ?`, id)
	var e domain.TimeEntry
	var ticketID sql.NullString
	var workDate time.Time
	var startAt, endAt sql.NullTime
	err := row.Scan(&e.ID, &ticketID, &e.TicketTitle, &e.User, &e.Hours,
		&workDate, &startAt, &endAt, &e.Note, &e.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if ticketID.Valid {
		s := ticketID.String
		e.TicketID = &s
	}
	e.WorkDate = workDate.Format("2006-01-02")
	if startAt.Valid {
		t := startAt.Time
		e.StartAt = &t
	}
	if endAt.Valid {
		t := endAt.Time
		e.EndAt = &t
	}
	return &e, nil
}

func (r *TimeEntryRepository) Create(ctx context.Context, e *domain.TimeEntry) error {
	e.CreatedAt = time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO time_entries (id, ticket_id, "user", hours, work_date, start_at, end_at, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, nullStr(e.TicketID), e.User, e.Hours, e.WorkDate,
		nullTime(e.StartAt), nullTime(e.EndAt),
		e.Note, e.CreatedAt,
	)
	return err
}

func (r *TimeEntryRepository) Update(ctx context.Context, e *domain.TimeEntry) error {
	res, err := r.db.ExecContext(ctx, `
        UPDATE time_entries
        SET ticket_id=?, "user"=?, hours=?, work_date=?, start_at=?, end_at=?, note=?
        WHERE id=?`,
		nullStr(e.TicketID), e.User, e.Hours, e.WorkDate,
		nullTime(e.StartAt), nullTime(e.EndAt), e.Note, e.ID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
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

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}
