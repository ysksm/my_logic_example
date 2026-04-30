package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

type SprintRepository struct {
	db *dbx.DB
}

func NewSprintRepository(db *dbx.DB) *SprintRepository {
	return &SprintRepository{db: db}
}

func (r *SprintRepository) List(ctx context.Context) ([]domain.Sprint, error) {
	rows, err := r.db.QueryContext(ctx, `
        SELECT id, name, goal, state, start_date, end_date, created_at
        FROM sprints
        ORDER BY
            CASE state WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
            COALESCE(start_date, created_at) DESC`)
	if err != nil {
		return nil, fmt.Errorf("query sprints: %w", err)
	}
	defer rows.Close()
	out := []domain.Sprint{}
	for rows.Next() {
		s, err := scanSprint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *SprintRepository) Get(ctx context.Context, id string) (*domain.Sprint, error) {
	row := r.db.QueryRowContext(ctx, `
        SELECT id, name, goal, state, start_date, end_date, created_at
        FROM sprints WHERE id = ?`, id)
	s, err := scanSprint(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *SprintRepository) Create(ctx context.Context, s *domain.Sprint) error {
	s.CreatedAt = time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO sprints (id, name, goal, state, start_date, end_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
		s.ID, s.Name, s.Goal, string(s.State), nullStr(s.StartDate), nullStr(s.EndDate), s.CreatedAt)
	return err
}

func (r *SprintRepository) Update(ctx context.Context, s *domain.Sprint) error {
	res, err := r.db.ExecContext(ctx, `
        UPDATE sprints SET name=?, goal=?, state=?, start_date=?, end_date=?
        WHERE id=?`,
		s.Name, s.Goal, string(s.State), nullStr(s.StartDate), nullStr(s.EndDate), s.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SprintRepository) Delete(ctx context.Context, id string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE tickets SET sprint_id = NULL WHERE sprint_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM sprints WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func scanSprint(s rowScanner) (domain.Sprint, error) {
	var (
		out                domain.Sprint
		state              string
		startDate, endDate sql.NullTime
		goal               sql.NullString
	)
	if err := s.Scan(&out.ID, &out.Name, &goal, &state, &startDate, &endDate, &out.CreatedAt); err != nil {
		return out, err
	}
	out.State = domain.SprintState(state)
	if goal.Valid {
		out.Goal = goal.String
	}
	if startDate.Valid {
		v := startDate.Time.Format("2006-01-02")
		out.StartDate = &v
	}
	if endDate.Valid {
		v := endDate.Time.Format("2006-01-02")
		out.EndDate = &v
	}
	return out, nil
}
