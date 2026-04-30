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
	rows, err := r.db.QueryContext(ctx, `
        SELECT ce.id, ce.title, ce.description, ce.start_date, ce.end_date,
               ce.start_at, ce.end_at, ce.ticket_id, t.title, ce.created_at
        FROM calendar_events ce
        LEFT JOIN tickets t ON t.id = ce.ticket_id
        ORDER BY ce.start_date, ce.start_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.CalendarEvent{}
	for rows.Next() {
		var e domain.CalendarEvent
		var start time.Time
		var end sql.NullTime
		var startAt, endAt sql.NullTime
		var ticketID, ticketTitle sql.NullString
		if err := rows.Scan(&e.ID, &e.Title, &e.Description, &start, &end,
			&startAt, &endAt, &ticketID, &ticketTitle, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.StartDate = start.Format("2006-01-02")
		if end.Valid {
			s := end.Time.Format("2006-01-02")
			e.EndDate = &s
		}
		if startAt.Valid {
			t := startAt.Time
			e.StartAt = &t
		}
		if endAt.Valid {
			t := endAt.Time
			e.EndAt = &t
		}
		if ticketID.Valid {
			s := ticketID.String
			e.TicketID = &s
		}
		if ticketTitle.Valid {
			s := ticketTitle.String
			e.TicketTitle = &s
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *CalendarRepository) CreateEvent(ctx context.Context, e *domain.CalendarEvent) error {
	e.CreatedAt = time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO calendar_events (id, title, description, start_date, end_date, start_at, end_at, ticket_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.Title, e.Description, e.StartDate, e.EndDate,
		nullTime(e.StartAt), nullTime(e.EndAt), nullStr(e.TicketID),
		e.CreatedAt,
	)
	return err
}

func nullStr(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func (r *CalendarRepository) UpdateEvent(ctx context.Context, e *domain.CalendarEvent) error {
	res, err := r.db.ExecContext(ctx, `
        UPDATE calendar_events
        SET title=?, description=?, start_date=?, end_date=?,
            start_at=?, end_at=?, ticket_id=?
        WHERE id=?`,
		e.Title, e.Description, e.StartDate, e.EndDate,
		nullTime(e.StartAt), nullTime(e.EndAt), nullStr(e.TicketID), e.ID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *CalendarRepository) GetEvent(ctx context.Context, id string) (*domain.CalendarEvent, error) {
	row := r.db.QueryRowContext(ctx, `
        SELECT ce.id, ce.title, ce.description, ce.start_date, ce.end_date,
               ce.start_at, ce.end_at, ce.ticket_id, t.title, ce.created_at
        FROM calendar_events ce
        LEFT JOIN tickets t ON t.id = ce.ticket_id
        WHERE ce.id = ?`, id)
	var e domain.CalendarEvent
	var start time.Time
	var end sql.NullTime
	var startAt, endAt sql.NullTime
	var ticketID, ticketTitle sql.NullString
	err := row.Scan(&e.ID, &e.Title, &e.Description, &start, &end,
		&startAt, &endAt, &ticketID, &ticketTitle, &e.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	e.StartDate = start.Format("2006-01-02")
	if end.Valid {
		s := end.Time.Format("2006-01-02")
		e.EndDate = &s
	}
	if startAt.Valid {
		t := startAt.Time
		e.StartAt = &t
	}
	if endAt.Valid {
		t := endAt.Time
		e.EndAt = &t
	}
	if ticketID.Valid {
		s := ticketID.String
		e.TicketID = &s
	}
	if ticketTitle.Valid {
		s := ticketTitle.String
		e.TicketTitle = &s
	}
	return &e, nil
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
            WHERE due_date IS NOT NULL
              AND due_date >= CAST(? AS DATE) AND due_date <= CAST(? AS DATE)`,
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
            SELECT te.id, te.ticket_id, t.title, te.hours, te.work_date, te.start_at, te.end_at, te.note
            FROM time_entries te LEFT JOIN tickets t ON t.id = te.ticket_id
            WHERE te.work_date >= CAST(? AS DATE) AND te.work_date <= CAST(? AS DATE)`,
			from, to)
		if err != nil {
			return nil, fmt.Errorf("time entries: %w", err)
		}
		for rows.Next() {
			var id string
			var ticketID, title sql.NullString
			var hours float64
			var date time.Time
			var startAt, endAt sql.NullTime
			var note string
			if err := rows.Scan(&id, &ticketID, &title, &hours, &date, &startAt, &endAt, &note); err != nil {
				rows.Close()
				return nil, err
			}
			eid := id
			displayTitle := title.String
			if displayTitle == "" {
				displayTitle = note
			}
			if displayTitle == "" {
				displayTitle = "(memo)"
			}
			h := hours
			item := domain.CalendarItem{
				Kind: "TIME_ENTRY", Date: date.Format("2006-01-02"),
				Title: displayTitle, Hours: &h, EntryID: &eid,
			}
			if ticketID.Valid {
				s := ticketID.String
				item.TicketID = &s
			}
			if startAt.Valid {
				v := startAt.Time
				item.StartAt = &v
			}
			if endAt.Valid {
				v := endAt.Time
				item.EndAt = &v
			}
			out = append(out, item)
		}
		rows.Close()
	}

	// Calendar events
	{
		rows, err := r.db.QueryContext(ctx, `
            SELECT ce.id, ce.title, ce.start_date, ce.start_at, ce.end_at, ce.ticket_id
            FROM calendar_events ce
            WHERE ce.start_date >= CAST(? AS DATE) AND ce.start_date <= CAST(? AS DATE)`,
			from, to)
		if err != nil {
			return nil, fmt.Errorf("events: %w", err)
		}
		for rows.Next() {
			var id, title string
			var start time.Time
			var startAt, endAt sql.NullTime
			var ticketID sql.NullString
			if err := rows.Scan(&id, &title, &start, &startAt, &endAt, &ticketID); err != nil {
				rows.Close()
				return nil, err
			}
			eid := id
			item := domain.CalendarItem{
				Kind: "EVENT", Date: start.Format("2006-01-02"), Title: title, EventID: &eid,
			}
			if startAt.Valid {
				v := startAt.Time
				item.StartAt = &v
			}
			if endAt.Valid {
				v := endAt.Time
				item.EndAt = &v
			}
			if ticketID.Valid {
				s := ticketID.String
				item.TicketID = &s
			}
			out = append(out, item)
		}
		rows.Close()
	}

	return out, nil
}
