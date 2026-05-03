package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

// Manager owns the set of in-flight stream sessions and the ring buffer of
// recent frames per session.
type Manager struct {
	cam Camera

	mu       sync.RWMutex
	sessions map[string]*sessionEntry
}

type sessionEntry struct {
	session   StreamSession
	cancel    context.CancelFunc
	ring      *frameRing
	listeners map[int]chan<- Frame
	nextLID   int
	stats     *sessionStats
	mu        sync.Mutex
}

type sessionStats struct {
	totalBytes uint64
	lastWidth  uint32
	lastHeight uint32
	fps        map[int64]*FpsBucket // unix-sec → bucket
}

func newSessionStats() *sessionStats {
	return &sessionStats{fps: make(map[int64]*FpsBucket)}
}

// NewManager constructs a Manager bound to the given Camera.
func NewManager(c Camera) *Manager {
	return &Manager{cam: c, sessions: make(map[string]*sessionEntry)}
}

// Devices is a passthrough to the underlying Camera.
func (m *Manager) Devices() ([]CameraDevice, error) { return m.cam.Devices() }

// Sessions returns a snapshot of all sessions.
func (m *Manager) Sessions() []StreamSession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]StreamSession, 0, len(m.sessions))
	for _, e := range m.sessions {
		e.mu.Lock()
		out = append(out, e.session)
		e.mu.Unlock()
	}
	return out
}

// Session returns the snapshot of a single session by id.
func (m *Manager) Session(id string) (StreamSession, bool) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return StreamSession{}, false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.session, true
}

// LatestFrame returns the most recent frame buffered for a session, useful for
// snapshot endpoints.
func (m *Manager) LatestFrame(id string) (Frame, bool) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return Frame{}, false
	}
	return e.ring.latest()
}

// Start begins a new stream session and returns its descriptor.
func (m *Manager) Start(req StartStreamRequest) (StreamSession, error) {
	if req.DeviceID == "" {
		return StreamSession{}, errors.New("device_id is required")
	}
	opts := CaptureOptions{
		DeviceID:  req.DeviceID,
		Width:     req.Width,
		Height:    req.Height,
		Framerate: req.Framerate,
		Quality:   req.Quality,
	}
	opts.applyDefaults()

	id, err := newID()
	if err != nil {
		return StreamSession{}, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	entry := &sessionEntry{
		session: StreamSession{
			ID:        id,
			DeviceID:  opts.DeviceID,
			Width:     opts.Width,
			Height:    opts.Height,
			Framerate: opts.Framerate,
			Quality:   opts.Quality,
			State:     StateRunning,
			StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
		},
		cancel:    cancel,
		ring:      newFrameRing(int(opts.Framerate*2) + 8),
		listeners: make(map[int]chan<- Frame),
		stats:     newSessionStats(),
	}

	m.mu.Lock()
	m.sessions[id] = entry
	m.mu.Unlock()

	go m.run(ctx, entry, opts)

	return entry.snapshot(), nil
}

// Stop signals the session to terminate. It returns the final snapshot.
func (m *Manager) Stop(id string) (StreamSession, error) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return StreamSession{}, errors.New("session not found")
	}
	e.cancel()

	for i := 0; i < 50; i++ {
		e.mu.Lock()
		s := e.session.State
		e.mu.Unlock()
		if s != StateRunning {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	return e.snapshot(), nil
}

// Subscribe registers ch to receive every frame pushed onto session id, until
// Unsubscribe is called or the session ends. The buffer of ch should be sized
// generously; slow listeners drop frames.
func (m *Manager) Subscribe(id string, ch chan<- Frame) (int, error) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return 0, errors.New("session not found")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.nextLID++
	lid := e.nextLID
	e.listeners[lid] = ch
	return lid, nil
}

// Unsubscribe removes a previously registered listener.
func (m *Manager) Unsubscribe(id string, lid int) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return
	}
	e.mu.Lock()
	delete(e.listeners, lid)
	e.mu.Unlock()
}

// Stats returns aggregated statistics for a session.
func (m *Manager) Stats(id string) (StatsResponse, error) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return StatsResponse{}, errors.New("session not found")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	resp := StatsResponse{
		TotalFrames: e.session.FrameCount,
		TotalBytes:  e.stats.totalBytes,
		LastWidth:   e.stats.lastWidth,
		LastHeight:  e.stats.lastHeight,
		FPS:         e.stats.fpsWindow(60),
	}
	if n := len(resp.FPS); n > 0 {
		resp.CurrentFPS = float64(resp.FPS[n-1].Count)
	}
	return resp, nil
}

func (m *Manager) run(ctx context.Context, e *sessionEntry, opts CaptureOptions) {
	out := make(chan Frame, 32)
	errCh := make(chan error, 1)
	go func() { errCh <- m.cam.Open(ctx, opts, out) }()

	for f := range out {
		e.mu.Lock()
		e.session.FrameCount++
		e.session.BytesSent += uint64(f.Size)
		e.stats.record(&f)
		e.ring.push(f)
		for _, ch := range e.listeners {
			select {
			case ch <- f:
			default: // drop on backpressure
			}
		}
		e.mu.Unlock()
	}

	err := <-errCh
	e.mu.Lock()
	e.session.StoppedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err != nil && !errors.Is(err, context.Canceled) {
		e.session.State = StateError
		e.session.Error = err.Error()
	} else {
		e.session.State = StateStopped
	}
	e.mu.Unlock()
}

func (e *sessionEntry) snapshot() StreamSession {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.session
}

func (s *sessionStats) record(f *Frame) {
	s.totalBytes += uint64(f.Size)
	s.lastWidth = f.Width
	s.lastHeight = f.Height

	now, _ := time.Parse(time.RFC3339Nano, f.CapturedAt)
	if now.IsZero() {
		now = time.Now().UTC()
	}
	sec := now.Unix()
	b, ok := s.fps[sec]
	if !ok {
		b = &FpsBucket{TS: time.Unix(sec, 0).UTC().Format(time.RFC3339)}
		s.fps[sec] = b
		cutoff := sec - 120
		for k := range s.fps {
			if k < cutoff {
				delete(s.fps, k)
			}
		}
	}
	b.Count++
	b.Bytes += uint64(f.Size)
}

func (s *sessionStats) fpsWindow(seconds int) []FpsBucket {
	if len(s.fps) == 0 {
		return nil
	}
	now := time.Now().UTC().Unix()
	out := make([]FpsBucket, 0, seconds)
	for sec := now - int64(seconds) + 1; sec <= now; sec++ {
		if b, ok := s.fps[sec]; ok {
			out = append(out, *b)
		} else {
			out = append(out, FpsBucket{TS: time.Unix(sec, 0).UTC().Format(time.RFC3339)})
		}
	}
	return out
}

func newID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
