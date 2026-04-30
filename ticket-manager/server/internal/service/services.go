package service

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/domain"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/git"
	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/repository"
)

type TicketService struct {
	repo *repository.TicketRepository
}

func NewTicketService(repo *repository.TicketRepository) *TicketService {
	return &TicketService{repo: repo}
}

func (s *TicketService) List(ctx context.Context, f repository.TicketFilter) ([]domain.Ticket, error) {
	return s.repo.List(ctx, f)
}

func (s *TicketService) Get(ctx context.Context, id string) (*domain.Ticket, error) {
	return s.repo.Get(ctx, id)
}

func (s *TicketService) Create(ctx context.Context, t *domain.Ticket, tags []string) error {
	if t.Title == "" {
		return errors.New("title is required")
	}
	if !t.Type.Valid() {
		return errors.New("invalid type")
	}
	if t.Status == "" {
		t.Status = domain.TicketStatusTodo
	} else if !t.Status.Valid() {
		return errors.New("invalid status")
	}
	t.ID = uuid.NewString()
	return s.repo.Create(ctx, t, tags)
}

func (s *TicketService) Update(ctx context.Context, t *domain.Ticket) error {
	if !t.Type.Valid() {
		return errors.New("invalid type")
	}
	if !t.Status.Valid() {
		return errors.New("invalid status")
	}
	return s.repo.Update(ctx, t)
}

func (s *TicketService) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func (s *TicketService) AddTag(ctx context.Context, ticketID, tag string) error {
	if tag == "" {
		return errors.New("tag is required")
	}
	return s.repo.AddTag(ctx, ticketID, tag)
}

func (s *TicketService) RemoveTag(ctx context.Context, ticketID, tag string) error {
	return s.repo.RemoveTag(ctx, ticketID, tag)
}

func (s *TicketService) ListTags(ctx context.Context) ([]domain.Tag, error) {
	return s.repo.ListTags(ctx)
}

type TimeEntryService struct {
	repo *repository.TimeEntryRepository
}

func NewTimeEntryService(repo *repository.TimeEntryRepository) *TimeEntryService {
	return &TimeEntryService{repo: repo}
}

func (s *TimeEntryService) List(ctx context.Context, f repository.TimeEntryFilter) ([]domain.TimeEntry, error) {
	return s.repo.List(ctx, f)
}

func (s *TimeEntryService) Create(ctx context.Context, e *domain.TimeEntry) error {
	if e.TicketID == "" {
		return errors.New("ticket_id required")
	}
	if e.Hours <= 0 {
		return errors.New("hours must be > 0")
	}
	if e.WorkDate == "" {
		return errors.New("work_date required")
	}
	e.ID = uuid.NewString()
	return s.repo.Create(ctx, e)
}

func (s *TimeEntryService) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

type CalendarService struct {
	repo *repository.CalendarRepository
}

func NewCalendarService(repo *repository.CalendarRepository) *CalendarService {
	return &CalendarService{repo: repo}
}

func (s *CalendarService) Range(ctx context.Context, from, to string) ([]domain.CalendarItem, error) {
	if from == "" || to == "" {
		return nil, errors.New("from and to required")
	}
	return s.repo.RangeItems(ctx, from, to)
}

func (s *CalendarService) ListEvents(ctx context.Context) ([]domain.CalendarEvent, error) {
	return s.repo.ListEvents(ctx)
}

func (s *CalendarService) CreateEvent(ctx context.Context, e *domain.CalendarEvent) error {
	if e.Title == "" {
		return errors.New("title required")
	}
	if e.StartDate == "" {
		return errors.New("start_date required")
	}
	e.ID = uuid.NewString()
	return s.repo.CreateEvent(ctx, e)
}

func (s *CalendarService) DeleteEvent(ctx context.Context, id string) error {
	return s.repo.DeleteEvent(ctx, id)
}

type RepositoryService struct {
	repo *repository.RepoRepository
	git  *git.Client
}

func NewRepositoryService(repo *repository.RepoRepository, g *git.Client) *RepositoryService {
	return &RepositoryService{repo: repo, git: g}
}

func (s *RepositoryService) List(ctx context.Context) ([]domain.Repository, error) {
	return s.repo.List(ctx)
}

func (s *RepositoryService) Create(ctx context.Context, rep *domain.Repository) error {
	if rep.Name == "" || rep.Path == "" {
		return errors.New("name and path are required")
	}
	abs, err := filepath.Abs(rep.Path)
	if err != nil {
		return fmt.Errorf("invalid path: %w", err)
	}
	rep.Path = abs
	if err := s.git.IsRepo(ctx, rep.Path); err != nil {
		return fmt.Errorf("path is not a git repository: %w", err)
	}
	rep.ID = uuid.NewString()
	return s.repo.Create(ctx, rep)
}

func (s *RepositoryService) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func (s *RepositoryService) ListBranches(ctx context.Context, id string) ([]string, error) {
	rep, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.git.ListBranches(ctx, rep.Path)
}

func (s *RepositoryService) CreateBranch(ctx context.Context, id, branch, from string, checkout bool) (string, error) {
	rep, err := s.repo.Get(ctx, id)
	if err != nil {
		return "", err
	}
	if from == "" {
		from = rep.DefaultBranch
	}
	if err := s.git.CreateBranch(ctx, rep.Path, branch, from, checkout); err != nil {
		return "", err
	}
	return branch, nil
}
