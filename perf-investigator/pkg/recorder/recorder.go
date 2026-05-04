// Package recorder persists Events to disk as newline-delimited JSON.
// Files are rotated by date so a long-running session leaves
// pi-2026-05-04.ndjson, pi-2026-05-05.ndjson, etc.
package recorder

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ysksm/my_logic_example/perf-investigator/pkg/events"
)

// Recorder writes events to disk and is safe for concurrent Emit calls.
type Recorder struct {
	dir     string
	prefix  string
	mu      sync.Mutex
	current *os.File
	bw      *bufio.Writer
	day     string
	count   int64
}

// New opens a recorder writing to dir. dir is created if missing.
func New(dir, prefix string) (*Recorder, error) {
	if dir == "" {
		return nil, errors.New("recorder: dir required")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if prefix == "" {
		prefix = "pi"
	}
	return &Recorder{dir: dir, prefix: prefix}, nil
}

func (r *Recorder) rotate(now time.Time) error {
	day := now.UTC().Format("2006-01-02")
	if r.current != nil && r.day == day {
		return nil
	}
	if r.bw != nil {
		_ = r.bw.Flush()
	}
	if r.current != nil {
		_ = r.current.Close()
	}
	path := filepath.Join(r.dir, fmt.Sprintf("%s-%s.ndjson", r.prefix, day))
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	r.current = f
	r.bw = bufio.NewWriterSize(f, 64*1024)
	r.day = day
	return nil
}

// Emit implements collectors.Sink.
func (r *Recorder) Emit(e events.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.rotate(e.Time); err != nil {
		return
	}
	raw, err := json.Marshal(e)
	if err != nil {
		return
	}
	_, _ = r.bw.Write(raw)
	_, _ = r.bw.Write([]byte{'\n'})
	r.count++
	if r.count%64 == 0 {
		_ = r.bw.Flush()
	}
}

// Flush forces buffered bytes to disk.
func (r *Recorder) Flush() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.bw != nil {
		return r.bw.Flush()
	}
	return nil
}

// Close flushes and closes the current file.
func (r *Recorder) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var err error
	if r.bw != nil {
		err = r.bw.Flush()
	}
	if r.current != nil {
		if cerr := r.current.Close(); err == nil {
			err = cerr
		}
		r.current = nil
		r.bw = nil
	}
	return err
}

// Count returns the number of events written.
func (r *Recorder) Count() int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.count
}
