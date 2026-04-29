//go:build pcap

package core

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcap"
)

// NewCapturer returns a libpcap-backed Capturer.
func NewCapturer() Capturer { return &pcapCapturer{} }

type pcapCapturer struct{}

func (p *pcapCapturer) Interfaces() ([]NetworkInterface, error) {
	devs, err := pcap.FindAllDevs()
	if err != nil {
		return nil, fmt.Errorf("pcap.FindAllDevs: %w", err)
	}
	out := make([]NetworkInterface, 0, len(devs))
	for _, d := range devs {
		ni := NetworkInterface{
			Name:        d.Name,
			Description: d.Description,
			IsLoopback:  d.Flags&pcap.FlagLoopback != 0,
			IsUp:        d.Flags&pcap.FlagUp != 0,
		}
		for _, a := range d.Addresses {
			if a.IP != nil {
				ni.Addresses = append(ni.Addresses, a.IP.String())
			}
		}
		out = append(out, ni)
	}
	return out, nil
}

func (p *pcapCapturer) Capture(ctx context.Context, opts CaptureOptions, out chan<- Packet) error {
	defer close(out)

	snaplen := int32(opts.Snaplen)
	if snaplen <= 0 {
		snaplen = 65535
	}
	handle, err := pcap.OpenLive(opts.Interface, snaplen, opts.Promiscuous, pcap.BlockForever)
	if err != nil {
		return fmt.Errorf("pcap.OpenLive(%s): %w", opts.Interface, err)
	}
	defer handle.Close()

	if opts.BPFFilter != "" {
		if err := handle.SetBPFFilter(opts.BPFFilter); err != nil {
			return fmt.Errorf("SetBPFFilter(%q): %w", opts.BPFFilter, err)
		}
	}

	source := gopacket.NewPacketSource(handle, handle.LinkType())
	source.NoCopy = true
	var seq uint64

	for {
		select {
		case <-ctx.Done():
			return nil
		case pkt, ok := <-source.Packets():
			if !ok {
				return nil
			}
			seq++
			out <- decodePacket(seq, opts.Interface, pkt)
		}
	}
}

func decodePacket(seq uint64, iface string, pkt gopacket.Packet) Packet {
	md := pkt.Metadata()
	p := Packet{
		Seq:           seq,
		CapturedAt:    md.Timestamp.UTC().Format(time.RFC3339Nano),
		Length:        uint32(md.Length),
		CaptureLength: uint32(md.CaptureLength),
		Interface:     iface,
	}

	// --- Link layer (Ethernet) ---
	if eth, _ := pkt.Layer(layers.LayerTypeEthernet).(*layers.Ethernet); eth != nil {
		p.LinkLayer = "Ethernet"
		src := eth.SrcMAC.String()
		dst := eth.DstMAC.String()
		p.Layers.Ethernet = &EthernetLayer{
			SrcMAC:    src,
			DstMAC:    dst,
			SrcVendor: LookupVendor(src),
			DstVendor: LookupVendor(dst),
			EtherType: eth.EthernetType.String(),
		}
		p.Src, p.Dst = src, dst
	} else if l := pkt.LinkLayer(); l != nil {
		p.LinkLayer = l.LayerType().String()
		s, d := l.LinkFlow().Endpoints()
		p.Src, p.Dst = s.String(), d.String()
	}

	// --- Network layer ---
	if ip4, _ := pkt.Layer(layers.LayerTypeIPv4).(*layers.IPv4); ip4 != nil {
		p.NetworkLayer = "IPv4"
		flags := []string{}
		if ip4.Flags&layers.IPv4DontFragment != 0 {
			flags = append(flags, "DF")
		}
		if ip4.Flags&layers.IPv4MoreFragments != 0 {
			flags = append(flags, "MF")
		}
		p.Layers.IP = &IPLayer{
			Version:      4,
			Src:          ip4.SrcIP.String(),
			Dst:          ip4.DstIP.String(),
			TTL:          uint32(ip4.TTL),
			Protocol:     uint32(ip4.Protocol),
			ProtocolName: ip4.Protocol.String(),
			Length:       uint32(ip4.Length),
			Flags:        strings.Join(flags, ","),
		}
		p.Src, p.Dst = ip4.SrcIP.String(), ip4.DstIP.String()
	} else if ip6, _ := pkt.Layer(layers.LayerTypeIPv6).(*layers.IPv6); ip6 != nil {
		p.NetworkLayer = "IPv6"
		p.Layers.IP = &IPLayer{
			Version:      6,
			Src:          ip6.SrcIP.String(),
			Dst:          ip6.DstIP.String(),
			TTL:          uint32(ip6.HopLimit),
			Protocol:     uint32(ip6.NextHeader),
			ProtocolName: ip6.NextHeader.String(),
			Length:       uint32(ip6.Length),
		}
		p.Src, p.Dst = ip6.SrcIP.String(), ip6.DstIP.String()
	} else if l := pkt.NetworkLayer(); l != nil {
		p.NetworkLayer = l.LayerType().String()
	}

	// --- Transport layer ---
	if tcp, _ := pkt.Layer(layers.LayerTypeTCP).(*layers.TCP); tcp != nil {
		p.TransportLayer = "TCP"
		p.Layers.TCP = &TCPLayer{
			SrcPort: uint32(tcp.SrcPort),
			DstPort: uint32(tcp.DstPort),
			Seq:     tcp.Seq,
			Ack:     tcp.Ack,
			Window:  uint32(tcp.Window),
			Flags:   tcpFlags(tcp),
			Length:  uint32(len(tcp.Payload)),
		}
		if p.Layers.IP != nil {
			p.Src = net.JoinHostPort(p.Layers.IP.Src, fmt.Sprintf("%d", tcp.SrcPort))
			p.Dst = net.JoinHostPort(p.Layers.IP.Dst, fmt.Sprintf("%d", tcp.DstPort))
		}
	} else if udp, _ := pkt.Layer(layers.LayerTypeUDP).(*layers.UDP); udp != nil {
		p.TransportLayer = "UDP"
		p.Layers.UDP = &UDPLayer{
			SrcPort: uint32(udp.SrcPort),
			DstPort: uint32(udp.DstPort),
			Length:  uint32(udp.Length),
		}
		if p.Layers.IP != nil {
			p.Src = net.JoinHostPort(p.Layers.IP.Src, fmt.Sprintf("%d", udp.SrcPort))
			p.Dst = net.JoinHostPort(p.Layers.IP.Dst, fmt.Sprintf("%d", udp.DstPort))
		}
	} else if icmp, _ := pkt.Layer(layers.LayerTypeICMPv4).(*layers.ICMPv4); icmp != nil {
		p.TransportLayer = "ICMPv4"
		p.Layers.ICMP = &ICMPLayer{
			Type: icmp.TypeCode.String(),
			Code: uint32(icmp.TypeCode.Code()),
		}
	} else if l := pkt.TransportLayer(); l != nil {
		p.TransportLayer = l.LayerType().String()
	}

	// --- Application layer (best-effort) ---
	if dns, _ := pkt.Layer(layers.LayerTypeDNS).(*layers.DNS); dns != nil {
		p.ApplicationLayer = "DNS"
		dl := &DNSLayer{
			Opcode:   dns.OpCode.String(),
			Response: dns.QR,
			Rcode:    dns.ResponseCode.String(),
		}
		for _, q := range dns.Questions {
			dl.Questions = append(dl.Questions, fmt.Sprintf("%s %s", string(q.Name), q.Type))
		}
		for _, a := range dns.Answers {
			dl.Answers = append(dl.Answers, fmt.Sprintf("%s %s %s", string(a.Name), a.Type, a.String()))
		}
		p.Layers.DNS = dl
	} else if app := pkt.ApplicationLayer(); app != nil {
		p.ApplicationLayer = app.LayerType().String()
		payload := app.Payload()
		if h := decodeHTTP(payload); h != nil {
			p.ApplicationLayer = "HTTP"
			p.Layers.HTTP = h
		} else if t := decodeTLSHandshake(payload); t != nil {
			p.ApplicationLayer = "TLS"
			p.Layers.TLS = t
		}
	}

	if err := pkt.ErrorLayer(); err != nil {
		p.Summary = "decode error: " + err.Error()
	} else {
		p.Summary = summarize(&p)
	}
	return p
}

func tcpFlags(t *layers.TCP) string {
	parts := []string{}
	if t.SYN {
		parts = append(parts, "SYN")
	}
	if t.ACK {
		parts = append(parts, "ACK")
	}
	if t.FIN {
		parts = append(parts, "FIN")
	}
	if t.RST {
		parts = append(parts, "RST")
	}
	if t.PSH {
		parts = append(parts, "PSH")
	}
	if t.URG {
		parts = append(parts, "URG")
	}
	return strings.Join(parts, ",")
}

func summarize(p *Packet) string {
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
		return "DNS"
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
		return fmt.Sprintf("TCP %d→%d [%s] seq=%d len=%d", t.SrcPort, t.DstPort, t.Flags, t.Seq, t.Length)
	}
	if p.Layers.UDP != nil {
		u := p.Layers.UDP
		return fmt.Sprintf("UDP %d→%d len=%d", u.SrcPort, u.DstPort, u.Length)
	}
	if p.Layers.ICMP != nil {
		return "ICMPv4 " + p.Layers.ICMP.Type
	}
	if p.NetworkLayer != "" {
		return p.NetworkLayer
	}
	return "frame"
}
