package core

import "context"

// Capturer is implemented by anything that can deliver packets from a NIC.
//
// Two implementations exist:
//   - capture_pcap.go (build tag `pcap`): real libpcap-backed capture for macOS/Linux.
//   - capture_fake.go (default):           in-memory simulator, useful for
//     development hosts that lack libpcap.
type Capturer interface {
	// Interfaces returns the list of capturable interfaces.
	Interfaces() ([]NetworkInterface, error)

	// Capture opens iface and pushes Packets to out until ctx is canceled or
	// an error occurs. Implementations must close out before returning.
	Capture(ctx context.Context, opts CaptureOptions, out chan<- Packet) error
}

// CaptureOptions are passed to Capturer.Capture.
type CaptureOptions struct {
	Interface   string
	BPFFilter   string
	Snaplen     uint32
	Promiscuous bool
}
