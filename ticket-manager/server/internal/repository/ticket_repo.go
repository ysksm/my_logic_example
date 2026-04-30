package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

var ErrNotFound = errors.New("not found")

type TicketRepository struct {
	db *dbx.DB
}

func NewTicketRepository(db *dbx.DB) *TicketRepository {
	return &TicketRepository{db: db}
}

type TicketFilter struct {
	Type     string
	Status   string
	ParentID *string // nil = no filter; pointer-to-empty-string => parent_id IS NULL
	Tag      string
	SprintID *string // nil = no filter; pointer-to-empty-string => sprint_id IS NULL (=backlog)
}

func (r *TicketRepository) List(ctx context.Context, f TicketFilter) ([]domain.Ticket, error) {
	var (
		conds  []string
		args   []any
	)
	if f.Type != "" {
		conds = append(conds, "t.type = ?")
		args = append(args, f.Type)
	}
	if f.Status != "" {
		conds = append(conds, "t.status = ?")
		args = append(args, f.Status)
	}
	if f.ParentID != nil {
		if *f.ParentID == "" {
			conds = append(conds, "t.parent_id IS NULL")
		} else {
			conds = append(conds, "t.parent_id = ?")
			args = append(args, *f.ParentID)
		}
	}
	if f.Tag != "" {
		conds = append(conds, "EXISTS (SELECT 1 FROM ticket_tags tt WHERE tt.ticket_id = t.id AND tt.tag_name = ?)")
		args = append(args, f.Tag)
	}
	if f.SprintID != nil {
		if *f.SprintID == "" {
			conds = append(conds, "t.sprint_id IS NULL")
		} else {
			conds = append(conds, "t.sprint_id = ?")
			args = append(args, *f.SprintID)
		}
	}
	q := `SELECT t.id, t.parent_id, t.title, t.description, t.type, t.status,
                 t.assignee, t.estimate_hours, t.due_date, t.repository_id, t.branch,
                 t.sprint_id, t.created_at, t.updated_at
          FROM tickets t`
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += " ORDER BY t.created_at DESC"

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query tickets: %w", err)
	}
	defer rows.Close()

	tickets := []domain.Ticket{}
	for rows.Next() {
		t, err := scanTicket(rows)
		if err != nil {
			return nil, err
		}
		tickets = append(tickets, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.attachTags(ctx, tickets); err != nil {
		return nil, err
	}
	return tickets, nil
}

func (r *TicketRepository) Get(ctx context.Context, id string) (*domain.Ticket, error) {
	row := r.db.QueryRowContext(ctx, `
        SELECT id, parent_id, title, description, type, status, assignee,
               estimate_hours, due_date, repository_id, branch, sprint_id,
               created_at, updated_at
        FROM tickets WHERE id = ?`, id)
	t, err := scanTicket(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := r.attachTags(ctx, []domain.Ticket{t}); err != nil {
		return nil, err
	}
	// attachTags works on slice, copy back
	one := []domain.Ticket{t}
	_ = r.attachTags(ctx, one)
	return &one[0], nil
}

func (r *TicketRepository) Create(ctx context.Context, t *domain.Ticket, tags []string) error {
	now := time.Now().UTC()
	t.CreatedAt = now
	t.UpdatedAt = now
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO tickets (id, parent_id, title, description, type, status,
                             assignee, estimate_hours, due_date, repository_id, branch,
                             sprint_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.ParentID, t.Title, t.Description, string(t.Type), string(t.Status),
		t.Assignee, t.EstimateHours, t.DueDate, t.RepositoryID, t.Branch,
		t.SprintID, t.CreatedAt, t.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert ticket: %w", err)
	}
	for _, tag := range tags {
		if err := r.AddTag(ctx, t.ID, tag); err != nil {
			return err
		}
	}
	t.Tags = tags
	return nil
}

func (r *TicketRepository) Update(ctx context.Context, t *domain.Ticket) error {
	t.UpdatedAt = time.Now().UTC()
	res, err := r.db.ExecContext(ctx, `
        UPDATE tickets SET parent_id=?, title=?, description=?, type=?, status=?,
            assignee=?, estimate_hours=?, due_date=?, repository_id=?, branch=?,
            sprint_id=?, updated_at=?
        WHERE id = ?`,
		t.ParentID, t.Title, t.Description, string(t.Type), string(t.Status),
		t.Assignee, t.EstimateHours, t.DueDate, t.RepositoryID, t.Branch,
		t.SprintID, t.UpdatedAt,
		t.ID,
	)
	if err != nil {
		return fmt.Errorf("update ticket: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *TicketRepository) Delete(ctx context.Context, id string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM ticket_tags WHERE ticket_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM time_entries WHERE ticket_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM tickets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (r *TicketRepository) AddTag(ctx context.Context, ticketID, tag string) error {
	now := time.Now().UTC()
	insertTag := fmt.Sprintf(`%s INTO tags (name, created_at) VALUES (?, ?)%s`,
		dbx.InsertVerb(r.db.Driver),
		dbx.OnConflictDoNothing(r.db.Driver, "name"),
	)
	if _, err := r.db.ExecContext(ctx, insertTag, tag, now); err != nil {
		return fmt.Errorf("upsert tag: %w", err)
	}
	insertLink := fmt.Sprintf(`%s INTO ticket_tags (ticket_id, tag_name) VALUES (?, ?)%s`,
		dbx.InsertVerb(r.db.Driver),
		dbx.OnConflictDoNothing(r.db.Driver, "ticket_id", "tag_name"),
	)
	if _, err := r.db.ExecContext(ctx, insertLink, ticketID, tag); err != nil {
		return fmt.Errorf("attach tag: %w", err)
	}
	return nil
}

func (r *TicketRepository) RemoveTag(ctx context.Context, ticketID, tag string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM ticket_tags WHERE ticket_id = ? AND tag_name = ?`, ticketID, tag)
	return err
}

func (r *TicketRepository) ListTags(ctx context.Context) ([]domain.Tag, error) {
	rows, err := r.db.QueryContext(ctx, `
        SELECT t.name, COALESCE(c.cnt, 0)
        FROM tags t
        LEFT JOIN (
            SELECT tag_name, COUNT(*) AS cnt FROM ticket_tags GROUP BY tag_name
        ) c ON c.tag_name = t.name
        ORDER BY t.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Tag{}
	for rows.Next() {
		var tag domain.Tag
		if err := rows.Scan(&tag.Name, &tag.UsageCount); err != nil {
			return nil, err
		}
		out = append(out, tag)
	}
	return out, rows.Err()
}

func (r *TicketRepository) attachTags(ctx context.Context, tickets []domain.Ticket) error {
	if len(tickets) == 0 {
		return nil
	}
	idxByID := make(map[string]int, len(tickets))
	for i := range tickets {
		tickets[i].Tags = []string{}
		idxByID[tickets[i].ID] = i
	}
	// Build IN clause
	placeholders := strings.Repeat("?,", len(tickets))
	placeholders = strings.TrimRight(placeholders, ",")
	args := make([]any, 0, len(tickets))
	for _, t := range tickets {
		args = append(args, t.ID)
	}
	q := fmt.Sprintf(`SELECT ticket_id, tag_name FROM ticket_tags WHERE ticket_id IN (%s)`, placeholders)
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, tag string
		if err := rows.Scan(&id, &tag); err != nil {
			return err
		}
		if i, ok := idxByID[id]; ok {
			tickets[i].Tags = append(tickets[i].Tags, tag)
		}
	}
	return rows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanTicket(s rowScanner) (domain.Ticket, error) {
	var (
		t           domain.Ticket
		parentID    sql.NullString
		assignee    sql.NullString
		estimate    sql.NullFloat64
		dueDate     sql.NullTime
		repoID      sql.NullString
		branch      sql.NullString
		sprintID    sql.NullString
		typ, status string
	)
	if err := s.Scan(&t.ID, &parentID, &t.Title, &t.Description, &typ, &status,
		&assignee, &estimate, &dueDate, &repoID, &branch, &sprintID,
		&t.CreatedAt, &t.UpdatedAt); err != nil {
		return t, err
	}
	t.Type = domain.TicketType(typ)
	t.Status = domain.TicketStatus(status)
	if parentID.Valid {
		v := parentID.String
		t.ParentID = &v
	}
	if assignee.Valid {
		v := assignee.String
		t.Assignee = &v
	}
	if estimate.Valid {
		v := estimate.Float64
		t.EstimateHours = &v
	}
	if dueDate.Valid {
		v := dueDate.Time.Format("2006-01-02")
		t.DueDate = &v
	}
	if repoID.Valid {
		v := repoID.String
		t.RepositoryID = &v
	}
	if branch.Valid {
		v := branch.String
		t.Branch = &v
	}
	if sprintID.Valid {
		v := sprintID.String
		t.SprintID = &v
	}
	t.Tags = []string{}
	return t, nil
}
