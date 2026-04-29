//go:build pcap

package core

import (
	"context"
	"fmt"
	"net"
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

	if l := pkt.LinkLayer(); l != nil {
		p.LinkLayer = l.LayerType().String()
		src, dst := l.LinkFlow().Endpoints()
		p.Src, p.Dst = src.String(), dst.String()
	}
	if l := pkt.NetworkLayer(); l != nil {
		p.NetworkLayer = l.LayerType().String()
		src, dst := l.NetworkFlow().Endpoints()
		p.Src, p.Dst = src.String(), dst.String()
	}
	if l := pkt.TransportLayer(); l != nil {
		p.TransportLayer = l.LayerType().String()
		src, dst := l.TransportFlow().Endpoints()
		// merge with network IP if present
		if p.NetworkLayer != "" {
			ns, nd := pkt.NetworkLayer().NetworkFlow().Endpoints()
			p.Src = net.JoinHostPort(ns.String(), src.String())
			p.Dst = net.JoinHostPort(nd.String(), dst.String())
		} else {
			p.Src, p.Dst = src.String(), dst.String()
		}
	}
	if l := pkt.ApplicationLayer(); l != nil {
		p.ApplicationLayer = l.LayerType().String()
	}
	if err := pkt.ErrorLayer(); err != nil {
		p.Summary = "decode error: " + err.Error()
	} else {
		p.Summary = summarize(pkt)
	}
	return p
}

func summarize(pkt gopacket.Packet) string {
	if t := pkt.Layer(layers.LayerTypeTCP); t != nil {
		tcp := t.(*layers.TCP)
		flags := ""
		if tcp.SYN {
			flags += "S"
		}
		if tcp.ACK {
			flags += "A"
		}
		if tcp.FIN {
			flags += "F"
		}
		if tcp.RST {
			flags += "R"
		}
		if tcp.PSH {
			flags += "P"
		}
		return fmt.Sprintf("TCP %d→%d [%s] seq=%d", tcp.SrcPort, tcp.DstPort, flags, tcp.Seq)
	}
	if u := pkt.Layer(layers.LayerTypeUDP); u != nil {
		udp := u.(*layers.UDP)
		return fmt.Sprintf("UDP %d→%d len=%d", udp.SrcPort, udp.DstPort, udp.Length)
	}
	if pkt.Layer(layers.LayerTypeICMPv4) != nil {
		return "ICMPv4"
	}
	if l := pkt.NetworkLayer(); l != nil {
		return l.LayerType().String()
	}
	return "frame"
}
