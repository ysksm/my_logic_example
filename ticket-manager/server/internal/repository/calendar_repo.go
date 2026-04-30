package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
)

type CalendarRepository struct {
	db *sql.DB
}

func NewCalendarRepository(db *sql.DB) *CalendarRepository {
	return &CalendarRepository{db: db}
}

func (r *CalendarRepository) ListEvents(ctx context.Context) ([]domain.CalendarEvent, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, title, description, start_date, end_date, created_at FROM calendar_events ORDER BY start_date`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.CalendarEvent{}
	for rows.Next() {
		var e domain.CalendarEvent
		var start time.Time
		var end sql.NullTime
		if err := rows.Scan(&e.ID, &e.Title, &e.Description, &start, &end, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.StartDate = start.Format("2006-01-02")
		if end.Valid {
			s := end.Time.Format("2006-01-02")
			e.EndDate = &s
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *CalendarRepository) CreateEvent(ctx context.Context, e *domain.CalendarEvent) error {
	e.CreatedAt = time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO calendar_events (id, title, description, start_date, end_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
		e.ID, e.Title, e.Description, e.StartDate, e.EndDate, e.CreatedAt,
	)
	return err
}

func (r *CalendarRepository) DeleteEvent(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM calendar_events WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Aggregate items in a date range: ticket due dates, time entries, calendar events.
func (r *CalendarRepository) RangeItems(ctx context.Context, from, to string) ([]domain.CalendarItem, error) {
	out := []domain.CalendarItem{}

	// Ticket due dates
	{
		rows, err := r.db.QueryContext(ctx, `
            SELECT id, title, status, due_date FROM tickets
            WHERE due_date IS NOT NULL AND due_date >= ? AND due_date <= ?`,
			from, to)
		if err != nil {
			return nil, fmt.Errorf("ticket dues: %w", err)
		}
		for rows.Next() {
			var id, title, status string
			var due time.Time
			if err := rows.Scan(&id, &title, &status, &due); err != nil {
				rows.Close()
				return nil, err
			}
			tid := id
			st := status
			out = append(out, domain.CalendarItem{
				Kind: "TICKET_DUE", Date: due.Format("2006-01-02"), Title: title,
				TicketID: &tid, Status: &st,
			})
		}
		rows.Close()
	}

	// Time entries
	{
		rows, err := r.db.QueryContext(ctx, `
            SELECT te.id, te.ticket_id, t.title, te.hours, te.work_date
            FROM time_entries te LEFT JOIN tickets t ON t.id = te.ticket_id
            WHERE te.work_date >= ? AND te.work_date <= ?`,
			from, to)
		if err != nil {
			return nil, fmt.Errorf("time entries: %w", err)
		}
		for rows.Next() {
			var id, ticketID string
			var title sql.NullString
			var hours float64
			var date time.Time
			if err := rows.Scan(&id, &ticketID, &title, &hours, &date); err != nil {
				rows.Close()
				return nil, err
			}
			t := title.String
			if t == "" {
				t = "(no ticket)"
			}
			tid := ticketID
			h := hours
			out = append(out, domain.CalendarItem{
				Kind: "TIME_ENTRY", Date: date.Format("2006-01-02"),
				Title: t, TicketID: &tid, Hours: &h,
			})
		}
		rows.Close()
	}

	// Calendar events
	{
		rows, err := r.db.QueryContext(ctx, `
            SELECT id, title, start_date FROM calendar_events
            WHERE start_date >= ? AND start_date <= ?`,
			from, to)
		if err != nil {
			return nil, fmt.Errorf("events: %w", err)
		}
		for rows.Next() {
			var id, title string
			var start time.Time
			if err := rows.Scan(&id, &title, &start); err != nil {
				rows.Close()
				return nil, err
			}
			eid := id
			out = append(out, domain.CalendarItem{
				Kind: "EVENT", Date: start.Format("2006-01-02"), Title: title, EventID: &eid,
			})
		}
		rows.Close()
	}

	return out, nil
}
