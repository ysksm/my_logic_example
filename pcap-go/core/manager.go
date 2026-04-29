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
	stats     *sessionStats
	mu        sync.Mutex
}

type sessionStats struct {
	totalBytes uint64
	transport  map[string]*ProtocolStat // by transport layer name
	appProto   map[string]*ProtocolStat // by application layer name
	peers      map[string]*peerAgg      // key = kind|addr
	rate       map[int64]*RateBucket    // unix-sec → bucket
}

// peerAgg tracks per-peer counters during capture; converted to Peer on read.
type peerAgg struct {
	Peer
}

func newSessionStats() *sessionStats {
	return &sessionStats{
		transport: make(map[string]*ProtocolStat),
		appProto:  make(map[string]*ProtocolStat),
		peers:     make(map[string]*peerAgg),
		rate:      make(map[int64]*RateBucket),
	}
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
		stats:     newSessionStats(),
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
		e.stats.record(&pkt)
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

// Peers returns the current peer aggregates for a session, sorted by packet
// count (descending). When kindFilter is non-empty ("ip" or "mac"), only that
// kind is returned.
func (m *Manager) Peers(id, kindFilter string) ([]Peer, error) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return nil, errors.New("session not found")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]Peer, 0, len(e.stats.peers))
	for _, p := range e.stats.peers {
		if kindFilter != "" && p.Kind != kindFilter {
			continue
		}
		out = append(out, p.Peer)
	}
	sortPeersByPackets(out)
	return out, nil
}

// Stats returns aggregated statistics for a session: protocol distribution,
// top peers, and a 60-second rate sparkline.
func (m *Manager) Stats(id string, topN int) (StatsResponse, error) {
	m.mu.RLock()
	e, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return StatsResponse{}, errors.New("session not found")
	}
	if topN <= 0 {
		topN = 10
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	resp := StatsResponse{
		TotalPackets: e.session.PacketCount,
		TotalBytes:   e.stats.totalBytes,
		Transport:    flattenProtoStats(e.stats.transport),
		Application:  flattenProtoStats(e.stats.appProto),
	}

	allPeers := make([]Peer, 0, len(e.stats.peers))
	for _, p := range e.stats.peers {
		allPeers = append(allPeers, p.Peer)
	}
	sortPeersByPackets(allPeers)
	if len(allPeers) > topN {
		allPeers = allPeers[:topN]
	}
	resp.TopPeers = allPeers
	resp.Rate = e.stats.rateWindow(60)
	return resp, nil
}

func (s *sessionStats) record(p *Packet) {
	s.totalBytes += uint64(p.Length)

	bumpProto(s.transport, p.TransportLayer, p.Length)
	bumpProto(s.appProto, p.ApplicationLayer, p.Length)

	now, _ := time.Parse(time.RFC3339Nano, p.CapturedAt)
	if now.IsZero() {
		now = time.Now().UTC()
	}
	sec := now.Unix()
	b, ok := s.rate[sec]
	if !ok {
		b = &RateBucket{TS: time.Unix(sec, 0).UTC().Format(time.RFC3339)}
		s.rate[sec] = b
		cutoff := sec - 120
		for k := range s.rate {
			if k < cutoff {
				delete(s.rate, k)
			}
		}
	}
	b.Count++
	b.Bytes += uint64(p.Length)

	tsStr := now.UTC().Format(time.RFC3339Nano)

	// IP peers
	if p.Layers.IP != nil {
		s.bumpPeer("ip", p.Layers.IP.Src, "", true, p.Length, tsStr)
		s.bumpPeer("ip", p.Layers.IP.Dst, "", false, p.Length, tsStr)
	}
	// MAC peers
	if p.Layers.Ethernet != nil {
		s.bumpPeer("mac", p.Layers.Ethernet.SrcMAC, p.Layers.Ethernet.SrcVendor, true, p.Length, tsStr)
		s.bumpPeer("mac", p.Layers.Ethernet.DstMAC, p.Layers.Ethernet.DstVendor, false, p.Length, tsStr)
	}
}

func (s *sessionStats) bumpPeer(kind, addr, vendor string, sent bool, length uint32, ts string) {
	if addr == "" {
		return
	}
	key := kind + "|" + addr
	p, ok := s.peers[key]
	if !ok {
		p = &peerAgg{Peer: Peer{Kind: kind, Address: addr, Vendor: vendor, FirstSeen: ts}}
		s.peers[key] = p
	}
	if vendor != "" && p.Vendor == "" {
		p.Vendor = vendor
	}
	p.Packets++
	p.Bytes += uint64(length)
	if sent {
		p.Sent++
	} else {
		p.Received++
	}
	p.LastSeen = ts
}

func (s *sessionStats) rateWindow(seconds int) []RateBucket {
	if len(s.rate) == 0 {
		return nil
	}
	now := time.Now().UTC().Unix()
	out := make([]RateBucket, 0, seconds)
	for sec := now - int64(seconds) + 1; sec <= now; sec++ {
		if b, ok := s.rate[sec]; ok {
			out = append(out, *b)
		} else {
			out = append(out, RateBucket{TS: time.Unix(sec, 0).UTC().Format(time.RFC3339)})
		}
	}
	return out
}

func bumpProto(m map[string]*ProtocolStat, name string, length uint32) {
	if name == "" {
		name = "OTHER"
	}
	s, ok := m[name]
	if !ok {
		s = &ProtocolStat{Name: name}
		m[name] = s
	}
	s.Count++
	s.Bytes += uint64(length)
}

func flattenProtoStats(m map[string]*ProtocolStat) []ProtocolStat {
	out := make([]ProtocolStat, 0, len(m))
	for _, v := range m {
		out = append(out, *v)
	}
	// stable order: by count desc then name asc
	for i := 1; i < len(out); i++ {
		j := i
		for j > 0 {
			a, b := out[j-1], out[j]
			if a.Count < b.Count || (a.Count == b.Count && a.Name > b.Name) {
				out[j-1], out[j] = b, a
				j--
				continue
			}
			break
		}
	}
	return out
}

func sortPeersByPackets(p []Peer) {
	for i := 1; i < len(p); i++ {
		j := i
		for j > 0 {
			a, b := p[j-1], p[j]
			if a.Packets < b.Packets || (a.Packets == b.Packets && a.Address > b.Address) {
				p[j-1], p[j] = b, a
				j--
				continue
			}
			break
		}
	}
}

func newID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
