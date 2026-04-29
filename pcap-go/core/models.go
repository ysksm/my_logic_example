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
