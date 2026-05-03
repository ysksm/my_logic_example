// Package core contains the domain types and business logic for webcam-go.
//
// Wire types are kept in sync with idl/webcam.proto. JSON tags use snake_case
// to match the IDL.
package core

// CameraDevice describes a capturable camera.
type CameraDevice struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Modes       []VideoMode `json:"modes,omitempty"`
}

// VideoMode is one supported capture mode of a camera.
type VideoMode struct {
	Width     uint32 `json:"width"`
	Height    uint32 `json:"height"`
	Framerate uint32 `json:"framerate"`
	PixelFmt  string `json:"pixel_fmt"`
}

// Frame is a single captured frame. Data is omitted from REST listings (only
// served on the streaming endpoints).
type Frame struct {
	Seq        uint64 `json:"seq"`
	CapturedAt string `json:"captured_at"`
	Width      uint32 `json:"width"`
	Height     uint32 `json:"height"`
	Mime       string `json:"mime"`
	Data       []byte `json:"-"`
	Size       uint32 `json:"size"`
}

// StreamSession reflects the lifecycle of a camera stream.
type StreamSession struct {
	ID         string `json:"id"`
	DeviceID   string `json:"device_id"`
	Width      uint32 `json:"width"`
	Height     uint32 `json:"height"`
	Framerate  uint32 `json:"framerate"`
	Quality    uint32 `json:"quality"`
	State      string `json:"state"`
	StartedAt  string `json:"started_at"`
	StoppedAt  string `json:"stopped_at,omitempty"`
	FrameCount uint64 `json:"frame_count"`
	BytesSent  uint64 `json:"bytes_sent"`
	Error      string `json:"error,omitempty"`
}

// Session states.
const (
	StateRunning = "running"
	StateStopped = "stopped"
	StateError   = "error"
)

// StartStreamRequest is the payload for POST /sessions.
type StartStreamRequest struct {
	DeviceID  string `json:"device_id"`
	Width     uint32 `json:"width"`
	Height    uint32 `json:"height"`
	Framerate uint32 `json:"framerate"`
	Quality   uint32 `json:"quality"`
}

// FpsBucket is one second of frame-rate history.
type FpsBucket struct {
	TS    string `json:"ts"`
	Count uint32 `json:"count"`
	Bytes uint64 `json:"bytes"`
}

// StatsResponse aggregates session statistics for the UI.
type StatsResponse struct {
	TotalFrames uint64      `json:"total_frames"`
	TotalBytes  uint64      `json:"total_bytes"`
	CurrentFPS  float64     `json:"current_fps"`
	LastWidth   uint32      `json:"last_width"`
	LastHeight  uint32      `json:"last_height"`
	FPS         []FpsBucket `json:"fps"`
}

// REST envelopes.
type ListDevicesResponse  struct{ Devices  []CameraDevice  `json:"devices"` }
type ListSessionsResponse struct{ Sessions []StreamSession `json:"sessions"` }
type StartStreamResponse  struct{ Session  StreamSession   `json:"session"` }
type StopStreamResponse   struct{ Session  StreamSession   `json:"session"` }

// StreamEnvelope is sent on the WebSocket text channel; binary frames carry
// the raw JPEG payload separately.
type StreamEnvelope struct {
	Type    string         `json:"type"`
	Session *StreamSession `json:"session,omitempty"`
	Frame   *Frame         `json:"frame,omitempty"`
	Message string         `json:"message,omitempty"`
}
