package core

import "context"

// Camera is implemented by anything that can deliver JPEG frames from a
// physical or simulated camera device.
//
// Two implementations exist:
//   - camera_ffmpeg.go (build tag `ffmpeg`): real capture via the system
//     ffmpeg binary. On macOS this uses AVFoundation; on Linux, v4l2.
//   - camera_fake.go (default):              a synthetic generator that
//     produces a moving gradient with a timestamp overlay. Useful on hosts
//     where ffmpeg is not installed.
type Camera interface {
	// Devices returns the list of available capture devices.
	Devices() ([]CameraDevice, error)

	// Open begins capturing from the device described by opts and pushes
	// JPEG-encoded Frames to out until ctx is canceled or an error occurs.
	// Implementations MUST close out before returning.
	Open(ctx context.Context, opts CaptureOptions, out chan<- Frame) error
}

// CaptureOptions are passed to Camera.Open.
type CaptureOptions struct {
	DeviceID  string
	Width     uint32
	Height    uint32
	Framerate uint32
	Quality   uint32 // JPEG quality 1..100
}

// applyDefaults fills in sensible defaults for unset fields.
func (o *CaptureOptions) applyDefaults() {
	if o.Width == 0 {
		o.Width = 640
	}
	if o.Height == 0 {
		o.Height = 480
	}
	if o.Framerate == 0 {
		o.Framerate = 15
	}
	if o.Quality == 0 || o.Quality > 100 {
		o.Quality = 75
	}
}
