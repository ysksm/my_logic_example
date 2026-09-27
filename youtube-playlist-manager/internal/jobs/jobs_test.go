package jobs

import (
	"context"
	"errors"
	"testing"
	"time"
)

func wait(t *testing.T, m *Manager, id string) Job {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		j, _ := m.Get(id)
		if j.Status != Running {
			return j
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("job did not finish")
	return Job{}
}

func TestLifecycle(t *testing.T) {
	m := NewManager(10)
	release := make(chan struct{})
	j, err := m.Start("fetch", "ch:1", "x", func(ctx context.Context, report Report) (any, error) {
		report(1, 2, "half")
		<-release
		return "ok", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start("fetch", "ch:1", "x", nil); !errors.Is(err, ErrBusy) {
		t.Fatalf("duplicate target must be rejected, got %v", err)
	}
	close(release)
	got := wait(t, m, j.ID)
	if got.Status != Done || got.Result != "ok" || got.Done != 1 || got.Total != 2 {
		t.Fatalf("unexpected job: %+v", got)
	}
	// The target is free again.
	j2, err := m.Start("fetch", "ch:1", "x", func(context.Context, Report) (any, error) { return nil, errors.New("boom") })
	if err != nil {
		t.Fatal(err)
	}
	if got := wait(t, m, j2.ID); got.Status != Failed || got.Error != "boom" {
		t.Fatalf("unexpected job: %+v", got)
	}
}

func TestCancel(t *testing.T) {
	m := NewManager(10)
	j, _ := m.Start("fetch", "t", "x", func(ctx context.Context, _ Report) (any, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	if err := m.Cancel(j.ID); err != nil {
		t.Fatal(err)
	}
	if got := wait(t, m, j.ID); got.Status != Canceled {
		t.Fatalf("want canceled, got %+v", got)
	}
	if err := m.Cancel("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestPrune(t *testing.T) {
	m := NewManager(2)
	for i := 0; i < 5; i++ {
		j, _ := m.Start("k", string(rune('a'+i)), "x", func(context.Context, Report) (any, error) { return nil, nil })
		wait(t, m, j.ID)
	}
	if n := len(m.List()); n != 2 {
		t.Fatalf("want 2 kept jobs, got %d", n)
	}
}
