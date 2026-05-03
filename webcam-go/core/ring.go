package core

import "sync"

// frameRing is a fixed-capacity ring buffer of recent frames per session.
// Frames are stored by ascending Seq; since(afterSeq, limit) returns frames
// with Seq > afterSeq capped at limit.
type frameRing struct {
	mu   sync.Mutex
	buf  []Frame
	head int // next write index
	full bool
}

func newFrameRing(cap int) *frameRing {
	if cap <= 0 {
		cap = 64
	}
	return &frameRing{buf: make([]Frame, cap)}
}

func (r *frameRing) push(f Frame) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf[r.head] = f
	r.head++
	if r.head >= len(r.buf) {
		r.head = 0
		r.full = true
	}
}

// latest returns the most recently pushed frame, or false when empty.
func (r *frameRing) latest() (Frame, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.full && r.head == 0 {
		return Frame{}, false
	}
	idx := r.head - 1
	if idx < 0 {
		idx = len(r.buf) - 1
	}
	return r.buf[idx], true
}

func (r *frameRing) since(afterSeq uint64, limit int) []Frame {
	r.mu.Lock()
	defer r.mu.Unlock()
	if limit <= 0 {
		limit = len(r.buf)
	}
	n := len(r.buf)
	count := r.head
	if r.full {
		count = n
	}
	out := make([]Frame, 0, count)
	start := 0
	if r.full {
		start = r.head
	}
	for i := 0; i < count; i++ {
		idx := (start + i) % n
		f := r.buf[idx]
		if f.Seq > afterSeq {
			out = append(out, f)
		}
	}
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}
