// Package core contains the domain types and business logic for pcap-go.
//
// Wire types are kept in sync with idl/pcap.proto. JSON tags use snake_case to
// match the IDL.
package core

// NetworkInterface describes a capturable interface.
type NetworkInterface struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Addresses   []string `json:"addresses"`
	IsLoopback  bool     `json:"is_loopback"`
	IsUp        bool     `json:"is_up"`
}

// Packet is the canonical wire representation of a captured frame.
type Packet struct {
	Seq              uint64 `json:"seq"`
	CapturedAt       string `json:"captured_at"`
	Length           uint32 `json:"length"`
	CaptureLength    uint32 `json:"capture_length"`
	Interface        string `json:"interface"`
	LinkLayer        string `json:"link_layer"`
	NetworkLayer     string `json:"network_layer"`
	TransportLayer   string `json:"transport_layer"`
	ApplicationLayer string `json:"application_layer"`
	Src              string `json:"src"`
	Dst              string `json:"dst"`
	Summary          string `json:"summary"`
	Payload          []byte `json:"payload,omitempty"`
	Layers           Layers `json:"layers"`
}

// Layers groups per-protocol decoded detail. Each field is optional.
type Layers struct {
	Ethernet *EthernetLayer `json:"ethernet,omitempty"`
	IP       *IPLayer       `json:"ip,omitempty"`
	TCP      *TCPLayer      `json:"tcp,omitempty"`
	UDP      *UDPLayer      `json:"udp,omitempty"`
	ICMP     *ICMPLayer     `json:"icmp,omitempty"`
	DNS      *DNSLayer      `json:"dns,omitempty"`
	HTTP     *HTTPLayer     `json:"http,omitempty"`
	TLS      *TLSLayer      `json:"tls,omitempty"`
}

type EthernetLayer struct {
	SrcMAC    string `json:"src_mac"`
	DstMAC    string `json:"dst_mac"`
	SrcVendor string `json:"src_vendor,omitempty"`
	DstVendor string `json:"dst_vendor,omitempty"`
	EtherType string `json:"ether_type,omitempty"`
}

type IPLayer struct {
	Version      uint32 `json:"version"`
	Src          string `json:"src"`
	Dst          string `json:"dst"`
	TTL          uint32 `json:"ttl,omitempty"`
	Protocol     uint32 `json:"protocol,omitempty"`
	ProtocolName string `json:"protocol_name,omitempty"`
	Length       uint32 `json:"length,omitempty"`
	Flags        string `json:"flags,omitempty"`
}

type TCPLayer struct {
	SrcPort uint32 `json:"src_port"`
	DstPort uint32 `json:"dst_port"`
	Seq     uint32 `json:"seq,omitempty"`
	Ack     uint32 `json:"ack,omitempty"`
	Window  uint32 `json:"window,omitempty"`
	Flags   string `json:"flags,omitempty"`
	Length  uint32 `json:"length,omitempty"`
}

type UDPLayer struct {
	SrcPort uint32 `json:"src_port"`
	DstPort uint32 `json:"dst_port"`
	Length  uint32 `json:"length,omitempty"`
}

type ICMPLayer struct {
	Type string `json:"type"`
	Code uint32 `json:"code,omitempty"`
}

type DNSLayer struct {
	Opcode    string   `json:"opcode,omitempty"`
	Response  bool     `json:"response"`
	Rcode     string   `json:"rcode,omitempty"`
	Questions []string `json:"questions,omitempty"`
	Answers   []string `json:"answers,omitempty"`
}

type HTTPLayer struct {
	Method      string `json:"method,omitempty"`
	Path        string `json:"path,omitempty"`
	Host        string `json:"host,omitempty"`
	StatusCode  uint32 `json:"status_code,omitempty"`
	UserAgent   string `json:"user_agent,omitempty"`
	ContentType string `json:"content_type,omitempty"`
}

type TLSLayer struct {
	Version   string `json:"version,omitempty"`
	Handshake string `json:"handshake,omitempty"`
	SNI       string `json:"sni,omitempty"`
}

// Peer aggregates traffic for a single endpoint (IP or MAC).
type Peer struct {
	Kind      string `json:"kind"`
	Address   string `json:"address"`
	Vendor    string `json:"vendor,omitempty"`
	Packets   uint64 `json:"packets"`
	Bytes     uint64 `json:"bytes"`
	Sent      uint64 `json:"sent"`
	Received  uint64 `json:"received"`
	FirstSeen string `json:"first_seen"`
	LastSeen  string `json:"last_seen"`
}

// ProtocolStat is one bucket of the protocol distribution.
type ProtocolStat struct {
	Name  string `json:"name"`
	Count uint64 `json:"count"`
	Bytes uint64 `json:"bytes"`
}

// RateBucket is one second of traffic for the rate sparkline.
type RateBucket struct {
	TS    string `json:"ts"`
	Count uint64 `json:"count"`
	Bytes uint64 `json:"bytes"`
}

// StatsResponse is the payload of GET /sessions/{id}/stats.
type StatsResponse struct {
	TotalPackets uint64         `json:"total_packets"`
	TotalBytes   uint64         `json:"total_bytes"`
	Transport    []ProtocolStat `json:"transport"`
	Application  []ProtocolStat `json:"application"`
	TopPeers     []Peer         `json:"top_peers"`
	Rate         []RateBucket   `json:"rate"`
}

// ListPeersResponse is the payload of GET /sessions/{id}/peers.
type ListPeersResponse struct {
	Peers []Peer `json:"peers"`
}

// OUIResponse is the payload of GET /oui/{mac}.
type OUIResponse struct {
	MAC    string `json:"mac"`
	Vendor string `json:"vendor"`
}

// CaptureSession reflects the lifecycle of a capture.
type CaptureSession struct {
	ID          string `json:"id"`
	Interface   string `json:"interface"`
	BPFFilter   string `json:"bpf_filter"`
	Snaplen     uint32 `json:"snaplen"`
	Promiscuous bool   `json:"promiscuous"`
	State       string `json:"state"`
	StartedAt   string `json:"started_at"`
	StoppedAt   string `json:"stopped_at,omitempty"`
	PacketCount uint64 `json:"packet_count"`
	Error       string `json:"error,omitempty"`
}

// Session states.
const (
	StateRunning = "running"
	StateStopped = "stopped"
	StateError   = "error"
)

// StartCaptureRequest is the payload for POST /sessions.
type StartCaptureRequest struct {
	Interface   string `json:"interface"`
	BPFFilter   string `json:"bpf_filter"`
	Snaplen     uint32 `json:"snaplen"`
	Promiscuous bool   `json:"promiscuous"`
}

// ListInterfacesResponse for GET /interfaces.
type ListInterfacesResponse struct {
	Interfaces []NetworkInterface `json:"interfaces"`
}

// StartCaptureResponse for POST /sessions.
type StartCaptureResponse struct {
	Session CaptureSession `json:"session"`
}

// StopCaptureResponse for DELETE /sessions/{id}.
type StopCaptureResponse struct {
	Session CaptureSession `json:"session"`
}

// ListSessionsResponse for GET /sessions.
type ListSessionsResponse struct {
	Sessions []CaptureSession `json:"sessions"`
}

// ListPacketsResponse for GET /sessions/{id}/packets.
type ListPacketsResponse struct {
	Packets []Packet `json:"packets"`
	NextSeq uint64   `json:"next_seq"`
}

// StreamEnvelope is one frame of the WebSocket stream.
type StreamEnvelope struct {
	Type    string          `json:"type"`
	Packet  *Packet         `json:"packet,omitempty"`
	Session *CaptureSession `json:"session,omitempty"`
	Message string          `json:"message,omitempty"`
}
