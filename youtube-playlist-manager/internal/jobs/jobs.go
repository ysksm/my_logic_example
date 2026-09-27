// Package jobs runs long operations (full channel fetches, transcript
// downloads) in the background and exposes their progress to the UI.
package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sort"
	"sync"
	"time"
)

// Status of a job.
const (
	Running  = "running"
	Done     = "done"
	Failed   = "error"
	Canceled = "canceled"
)

// Job is a snapshot of a background operation.
type Job struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	Target     string    `json:"target"`
	Label      string    `json:"label"`
	Status     string    `json:"status"`
	Done       int       `json:"done"`
	Total      int       `json:"total"`
	Message    string    `json:"message"`
	Result     any       `json:"result,omitempty"`
	Error      string    `json:"error,omitempty"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt,omitempty"`
}

// Report updates a running job's progress. total <= 0 means unknown.
type Report func(done, total int, message string)

// Func is the work of a job.
type Func func(ctx context.Context, report Report) (any, error)

// ErrBusy is returned when a job for the same target is already running.
var ErrBusy = errors.New("同じ対象の処理がすでに実行中です")

// ErrNotFound is returned for an unknown job ID.
var ErrNotFound = errors.New("job not found")

// Manager keeps running and recently finished jobs in memory.
type Manager struct {
	mu      sync.Mutex
	jobs    map[string]*Job
	cancels map[string]context.CancelFunc
	keep    int
}

// NewManager returns a Manager remembering the last keep finished jobs.
func NewManager(keep int) *Manager {
	return &Manager{jobs: map[string]*Job{}, cancels: map[string]context.CancelFunc{}, keep: keep}
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Start runs fn in the background. target identifies what the job works on
// (e.g. "channel:UC…"); only one running job per target is allowed.
func (m *Manager) Start(kind, target, label string, fn Func) (Job, error) {
	m.mu.Lock()
	for _, j := range m.jobs {
		if j.Status == Running && j.Target == target {
			m.mu.Unlock()
			return Job{}, ErrBusy
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &Job{ID: newID(), Kind: kind, Target: target, Label: label, Status: Running, StartedAt: time.Now()}
	m.jobs[j.ID] = j
	m.cancels[j.ID] = cancel
	snap := *j
	m.mu.Unlock()

	go func() {
		defer cancel()
		res, err := fn(ctx, func(done, total int, msg string) {
			m.mu.Lock()
			j.Done, j.Total, j.Message = done, total, msg
			m.mu.Unlock()
		})
		m.mu.Lock()
		defer m.mu.Unlock()
		j.Result, j.FinishedAt = res, time.Now()
		switch {
		case err == nil:
			j.Status = Done
		case errors.Is(err, context.Canceled):
			j.Status = Canceled
		default:
			j.Status, j.Error = Failed, err.Error()
		}
		delete(m.cancels, j.ID)
		m.pruneLocked()
	}()
	return snap, nil
}

// Cancel requests cancellation of a running job.
func (m *Manager) Cancel(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.cancels[id]
	if !ok {
		if _, exists := m.jobs[id]; exists {
			return nil // already finished
		}
		return ErrNotFound
	}
	c()
	return nil
}

// List returns jobs, running first, then most recently finished.
func (m *Manager) List() []Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Job, 0, len(m.jobs))
	for _, j := range m.jobs {
		out = append(out, *j)
	}
	sort.Slice(out, func(i, k int) bool {
		if (out[i].Status == Running) != (out[k].Status == Running) {
			return out[i].Status == Running
		}
		return out[i].StartedAt.After(out[k].StartedAt)
	})
	return out
}

// Get returns one job.
func (m *Manager) Get(id string) (Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return Job{}, ErrNotFound
	}
	return *j, nil
}

func (m *Manager) pruneLocked() {
	var finished []*Job
	for _, j := range m.jobs {
		if j.Status != Running {
			finished = append(finished, j)
		}
	}
	if len(finished) <= m.keep {
		return
	}
	sort.Slice(finished, func(i, k int) bool { return finished[i].FinishedAt.After(finished[k].FinishedAt) })
	for _, j := range finished[m.keep:] {
		delete(m.jobs, j.ID)
	}
}
