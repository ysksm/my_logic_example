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

// Each fake host has a fixed MAC so the OUI lookup produces a stable vendor.
type fakeHost struct {
	ip   string
	mac  string
	name string
}

var fakeLocal = []fakeHost{
	{ip: "192.168.1.42", mac: "F0:DC:E2:11:22:33", name: "MacBook"}, // Apple OUI
	{ip: "192.168.1.10", mac: "B8:27:EB:AA:BB:CC", name: "Pi"},      // Raspberry Pi
	{ip: "192.168.1.55", mac: "F4:F5:E8:33:44:55", name: "Nest"},    // Google
	{ip: "192.168.1.77", mac: "FC:A1:83:66:77:88", name: "Echo"},    // Amazon
	{ip: "192.168.1.91", mac: "84:51:81:99:AA:BB", name: "Phone"},   // Samsung
}

var fakeRouterMAC = "00:25:84:DE:AD:01" // Cisco

var fakeRemotes = []struct {
	ip      string
	host    string
	port    int
	app     string
	netVer  uint32
	netName string
}{
	{ip: "142.250.78.110", host: "www.google.com", port: 443, app: "TLS", netVer: 4, netName: "IPv4"},
	{ip: "142.250.78.110", host: "www.google.com", port: 80, app: "HTTP", netVer: 4, netName: "IPv4"},
	{ip: "8.8.8.8", host: "dns.google", port: 53, app: "DNS", netVer: 4, netName: "IPv4"},
	{ip: "1.1.1.1", host: "one.one.one.one", port: 53, app: "DNS", netVer: 4, netName: "IPv4"},
	{ip: "151.101.1.69", host: "github.io", port: 443, app: "TLS", netVer: 4, netName: "IPv4"},
	{ip: "140.82.114.3", host: "github.com", port: 443, app: "TLS", netVer: 4, netName: "IPv4"},
	{ip: "13.107.42.14", host: "outlook.office365.com", port: 443, app: "TLS", netVer: 4, netName: "IPv4"},
	{ip: "2606:4700::6810:84e5", host: "cloudflare.com", port: 443, app: "TLS", netVer: 6, netName: "IPv6"},
	{ip: "162.159.61.3", host: "discord.com", port: 443, app: "TLS", netVer: 4, netName: "IPv4"},
	{ip: "192.168.1.1", host: "router.local", port: 80, app: "HTTP", netVer: 4, netName: "IPv4"},
}

func (f *fakeCapturer) fabricate(seq uint64, iface string, r *rand.Rand) Packet {
	local := fakeLocal[r.Intn(len(fakeLocal))]
	remote := fakeRemotes[r.Intn(len(fakeRemotes))]
	outbound := r.Intn(2) == 0
	srcPort := 30000 + r.Intn(20000)
	length := uint32(60 + r.Intn(1400))

	now := time.Now().UTC()
	p := Packet{
		Seq:           seq,
		CapturedAt:    now.Format(time.RFC3339Nano),
		Length:        length,
		CaptureLength: length,
		Interface:     iface,
		LinkLayer:     "Ethernet",
		NetworkLayer:  remote.netName,
	}
	srcMAC, dstMAC := local.mac, fakeRouterMAC
	srcIP, dstIP := local.ip, remote.ip
	srcP, dstP := srcPort, remote.port
	if !outbound {
		srcMAC, dstMAC = dstMAC, srcMAC
		srcIP, dstIP = dstIP, srcIP
		srcP, dstP = remote.port, srcPort
	}
	p.Layers.Ethernet = &EthernetLayer{
		SrcMAC:    srcMAC,
		DstMAC:    dstMAC,
		SrcVendor: LookupVendor(srcMAC),
		DstVendor: LookupVendor(dstMAC),
		EtherType: remote.netName,
	}
	p.Layers.IP = &IPLayer{
		Version:      remote.netVer,
		Src:          srcIP,
		Dst:          dstIP,
		TTL:          uint32(54 + r.Intn(10)),
		Protocol:     6,
		ProtocolName: "TCP",
		Length:       length,
		Flags:        "DF",
	}

	switch remote.app {
	case "DNS":
		p.TransportLayer = "UDP"
		p.Layers.IP.Protocol = 17
		p.Layers.IP.ProtocolName = "UDP"
		p.Layers.UDP = &UDPLayer{SrcPort: uint32(srcP), DstPort: uint32(dstP), Length: length}
		p.ApplicationLayer = "DNS"
		question := []string{remote.host + " A"}
		var answers []string
		response := r.Intn(2) == 0
		if response {
			answers = []string{remote.host + " A " + remote.ip}
		}
		p.Layers.DNS = &DNSLayer{
			Opcode:    "Query",
			Response:  response,
			Rcode:     "NoError",
			Questions: question,
			Answers:   answers,
		}
	case "HTTP":
		p.TransportLayer = "TCP"
		p.Layers.TCP = &TCPLayer{
			SrcPort: uint32(srcP), DstPort: uint32(dstP),
			Seq: r.Uint32(), Ack: r.Uint32(), Window: uint32(8000 + r.Intn(50000)),
			Flags: "PSH,ACK", Length: length - 40,
		}
		p.ApplicationLayer = "HTTP"
		if outbound {
			p.Layers.HTTP = &HTTPLayer{
				Method: []string{"GET", "POST", "PUT"}[r.Intn(3)],
				Path:   []string{"/", "/api/v1/users", "/static/app.js", "/login"}[r.Intn(4)],
				Host:   remote.host,
				UserAgent: "Mozilla/5.0",
			}
		} else {
			p.Layers.HTTP = &HTTPLayer{
				StatusCode:  uint32([]int{200, 200, 304, 404, 500}[r.Intn(5)]),
				ContentType: []string{"text/html", "application/json", "image/png"}[r.Intn(3)],
			}
		}
	case "TLS":
		p.TransportLayer = "TCP"
		p.Layers.TCP = &TCPLayer{
			SrcPort: uint32(srcP), DstPort: uint32(dstP),
			Seq: r.Uint32(), Ack: r.Uint32(), Window: uint32(8000 + r.Intn(50000)),
			Flags: "PSH,ACK", Length: length - 40,
		}
		p.ApplicationLayer = "TLS"
		hs := []string{"ClientHello", "ServerHello", "Certificate", "Finished"}[r.Intn(4)]
		t := &TLSLayer{Version: "TLS 1.3", Handshake: hs}
		if hs == "ClientHello" {
			t.SNI = remote.host
		}
		p.Layers.TLS = t
	}

	// Best-effort src/dst strings
	if p.TransportLayer == "TCP" || p.TransportLayer == "UDP" {
		p.Src = fmt.Sprintf("%s:%d", srcIP, srcP)
		p.Dst = fmt.Sprintf("%s:%d", dstIP, dstP)
	} else {
		p.Src = srcIP
		p.Dst = dstIP
	}
	p.Summary = fakeSummary(&p)
	return p
}

func fakeSummary(p *Packet) string {
	if p.Layers.HTTP != nil {
		h := p.Layers.HTTP
		if h.Method != "" {
			return fmt.Sprintf("HTTP %s %s%s", h.Method, h.Host, h.Path)
		}
		return fmt.Sprintf("HTTP %d %s", h.StatusCode, h.ContentType)
	}
	if p.Layers.DNS != nil {
		d := p.Layers.DNS
		if d.Response {
			return fmt.Sprintf("DNS resp %s answers=%d", d.Rcode, len(d.Answers))
		}
		if len(d.Questions) > 0 {
			return "DNS query " + d.Questions[0]
		}
	}
	if p.Layers.TLS != nil {
		t := p.Layers.TLS
		if t.SNI != "" {
			return fmt.Sprintf("TLS %s %s sni=%s", t.Version, t.Handshake, t.SNI)
		}
		return fmt.Sprintf("TLS %s %s", t.Version, t.Handshake)
	}
	if p.Layers.TCP != nil {
		t := p.Layers.TCP
		return fmt.Sprintf("TCP %d→%d [%s] len=%d", t.SrcPort, t.DstPort, t.Flags, t.Length)
	}
	if p.Layers.UDP != nil {
		u := p.Layers.UDP
		return fmt.Sprintf("UDP %d→%d len=%d", u.SrcPort, u.DstPort, u.Length)
	}
	return "frame"
}
