package core

// packetRing is a fixed-capacity ring buffer of Packet, indexed by Seq for
// "give me everything since X" queries. It is NOT goroutine-safe; the calling
// sessionEntry holds a mutex.
type packetRing struct {
	buf  []Packet
	cap  int
	head int // index of the next write
	size int // number of valid entries (≤ cap)
}

func newPacketRing(capacity int) *packetRing {
	return &packetRing{buf: make([]Packet, capacity), cap: capacity}
}

func (r *packetRing) push(p Packet) {
	r.buf[r.head] = p
	r.head = (r.head + 1) % r.cap
	if r.size < r.cap {
		r.size++
	}
}

// since returns up to limit packets with Seq > afterSeq, in ascending Seq order.
func (r *packetRing) since(afterSeq uint64, limit int) []Packet {
	if r.size == 0 {
		return nil
	}
	start := (r.head - r.size + r.cap) % r.cap
	out := make([]Packet, 0, min(limit, r.size))
	for i := 0; i < r.size && len(out) < limit; i++ {
		idx := (start + i) % r.cap
		if r.buf[idx].Seq > afterSeq {
			out = append(out, r.buf[idx])
		}
	}
	return out
}
