//go:build !pcap

package core

import (
	"context"
	"fmt"
	"math/rand"
	"time"
)

// NewCapturer returns a synthetic Capturer that fabricates traffic.
//
// This implementation is selected when the program is built without the
// `pcap` build tag, so the project can be developed and demoed on hosts that
// lack libpcap. Build with `-tags pcap` for real capture on macOS/Linux.
func NewCapturer() Capturer { return &fakeCapturer{} }

type fakeCapturer struct{}

func (f *fakeCapturer) Interfaces() ([]NetworkInterface, error) {
	return []NetworkInterface{
		{Name: "en0", Description: "Wi-Fi (simulated)", Addresses: []string{"192.168.1.42"}, IsUp: true},
		{Name: "lo0", Description: "Loopback (simulated)", Addresses: []string{"127.0.0.1"}, IsUp: true, IsLoopback: true},
	}, nil
}

func (f *fakeCapturer) Capture(ctx context.Context, opts CaptureOptions, out chan<- Packet) error {
	defer close(out)
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	tick := time.NewTicker(150 * time.Millisecond)
	defer tick.Stop()

	var seq uint64
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			seq++
			out <- f.fabricate(seq, opts.Interface, r)
		}
	}
}

func (f *fakeCapturer) fabricate(seq uint64, iface string, r *rand.Rand) Packet {
	protocols := []struct {
		net, transport, app string
		port                int
	}{
		{"IPv4", "TCP", "HTTP", 80},
		{"IPv4", "TCP", "TLS", 443},
		{"IPv4", "UDP", "DNS", 53},
		{"IPv6", "TCP", "TLS", 443},
		{"IPv4", "ICMPv4", "", 0},
	}
	p := protocols[r.Intn(len(protocols))]
	srcIP := fmt.Sprintf("192.168.1.%d", 10+r.Intn(50))
	dstIP := fmt.Sprintf("142.250.%d.%d", r.Intn(255), r.Intn(255))
	srcPort := 30000 + r.Intn(20000)
	length := uint32(60 + r.Intn(1400))

	pkt := Packet{
		Seq:              seq,
		CapturedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Length:           length,
		CaptureLength:    length,
		Interface:        iface,
		LinkLayer:        "Ethernet",
		NetworkLayer:     p.net,
		TransportLayer:   p.transport,
		ApplicationLayer: p.app,
	}
	if p.transport == "ICMPv4" {
		pkt.Src = srcIP
		pkt.Dst = dstIP
		pkt.Summary = "ICMPv4 echo"
		return pkt
	}
	pkt.Src = fmt.Sprintf("%s:%d", srcIP, srcPort)
	pkt.Dst = fmt.Sprintf("%s:%d", dstIP, p.port)
	pkt.Summary = fmt.Sprintf("%s %d→%d len=%d", p.transport, srcPort, p.port, length)
	return pkt
}
