package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/infra/dbx"
)

type RepoRepository struct {
	db *dbx.DB
}

func NewRepoRepository(db *dbx.DB) *RepoRepository {
	return &RepoRepository{db: db}
}

func (r *RepoRepository) List(ctx context.Context) ([]domain.Repository, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name, path, default_branch, created_at FROM repositories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Repository{}
	for rows.Next() {
		var rep domain.Repository
		if err := rows.Scan(&rep.ID, &rep.Name, &rep.Path, &rep.DefaultBranch, &rep.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rep)
	}
	return out, rows.Err()
}

func (r *RepoRepository) Get(ctx context.Context, id string) (*domain.Repository, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, name, path, default_branch, created_at FROM repositories WHERE id = ?`, id)
	var rep domain.Repository
	if err := row.Scan(&rep.ID, &rep.Name, &rep.Path, &rep.DefaultBranch, &rep.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &rep, nil
}

func (r *RepoRepository) Create(ctx context.Context, rep *domain.Repository) error {
	rep.CreatedAt = time.Now().UTC()
	if rep.DefaultBranch == "" {
		rep.DefaultBranch = "main"
	}
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO repositories (id, name, path, default_branch, created_at)
        VALUES (?, ?, ?, ?, ?)`,
		rep.ID, rep.Name, rep.Path, rep.DefaultBranch, rep.CreatedAt,
	)
	return err
}

func (r *RepoRepository) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM repositories WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
