package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

// Manager owns the set of in-flight CaptureSessions and the ring buffers that
// retain recently captured packets per session.
type Manager struct {
	cap Capturer

	mu       sync.RWMutex
	sessions map[string]*sessionEntry
}

type sessionEntry struct {
	session   CaptureSession
	cancel    context.CancelFunc
	ring      *packetRing
	listeners map[int]chan<- Packet
	nextLID   int
	mu        sync.Mutex
}

// NewManager constructs a Manager bound to the given Capturer.
func NewManager(c Capturer) *Manager {
	return &Manager{cap: c, sessions: make(map[string]*sessionEntry)}
}

// Interfaces is a passthrough to the underlying Capturer.
func (m *Manager) Interfaces() ([]NetworkInterface, error) { return m.cap.Interfaces() }

// Sessions returns a snapshot of all sessions.
func (m *Manager) Sessions() []CaptureSession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]CaptureSession, 0, len(m.sessions))
	for _, e := range m.sessions {
		e.mu.Lock()
		out = append(out, e.session)
		e.mu.Unlock()
	}
	return out
}

// Session returns the snapshot of a single session by id.
func (m *Manager) Session(id string) (CaptureSession, bool) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return CaptureSession{}, false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.session, true
}

// Start begins a new capture session and returns its descriptor.
func (m *Manager) Start(req StartCaptureRequest) (CaptureSession, error) {
	if req.Interface == "" {
		return CaptureSession{}, errors.New("interface is required")
	}
	if req.Snaplen == 0 {
		req.Snaplen = 65535
	}

	id, err := newID()
	if err != nil {
		return CaptureSession{}, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	entry := &sessionEntry{
		session: CaptureSession{
			ID:          id,
			Interface:   req.Interface,
			BPFFilter:   req.BPFFilter,
			Snaplen:     req.Snaplen,
			Promiscuous: req.Promiscuous,
			State:       StateRunning,
			StartedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		},
		cancel:    cancel,
		ring:      newPacketRing(2048),
		listeners: make(map[int]chan<- Packet),
	}

	m.mu.Lock()
	m.sessions[id] = entry
	m.mu.Unlock()

	go m.run(ctx, entry, CaptureOptions{
		Interface:   req.Interface,
		BPFFilter:   req.BPFFilter,
		Snaplen:     req.Snaplen,
		Promiscuous: req.Promiscuous,
	})

	return entry.snapshot(), nil
}

// Stop signals the session to terminate. It returns the final snapshot.
func (m *Manager) Stop(id string) (CaptureSession, error) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return CaptureSession{}, errors.New("session not found")
	}
	e.cancel()

	// Wait briefly for the run goroutine to finalize state.
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

// Packets returns buffered packets for a session with seq > afterSeq, capped
// at limit. The returned nextSeq is the highest seq seen (or afterSeq if none).
func (m *Manager) Packets(id string, afterSeq uint64, limit int) ([]Packet, uint64, error) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return nil, 0, errors.New("session not found")
	}
	if limit <= 0 {
		limit = 200
	}
	pkts := e.ring.since(afterSeq, limit)
	next := afterSeq
	if len(pkts) > 0 {
		next = pkts[len(pkts)-1].Seq
	}
	return pkts, next, nil
}

// Subscribe registers ch to receive every packet pushed onto session id, until
// Unsubscribe is called or the session ends. The buffer of ch should be sized
// generously; slow listeners drop packets.
func (m *Manager) Subscribe(id string, ch chan<- Packet) (int, error) {
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

func (m *Manager) run(ctx context.Context, e *sessionEntry, opts CaptureOptions) {
	out := make(chan Packet, 256)
	errCh := make(chan error, 1)
	go func() { errCh <- m.cap.Capture(ctx, opts, out) }()

	for pkt := range out {
		e.mu.Lock()
		e.session.PacketCount++
		e.ring.push(pkt)
		for _, ch := range e.listeners {
			select {
			case ch <- pkt:
			default: // drop on backpressure
			}
		}
		e.mu.Unlock()
	}

	err := <-errCh
	e.mu.Lock()
	e.session.StoppedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err != nil {
		e.session.State = StateError
		e.session.Error = err.Error()
	} else {
		e.session.State = StateStopped
	}
	for _, ch := range e.listeners {
		// best-effort: don't block on close; listeners will notice via session state
		_ = ch
	}
	e.mu.Unlock()
}

func (e *sessionEntry) snapshot() CaptureSession {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.session
}

func newID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
