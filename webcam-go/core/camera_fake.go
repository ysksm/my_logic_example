//go:build !ffmpeg

package core

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"time"
)

// NewCamera returns a synthetic Camera that fabricates frames.
//
// This implementation is selected when the program is built without the
// `ffmpeg` build tag, so the project can be developed and demoed on hosts
// that lack ffmpeg. Build with `-tags ffmpeg` for real camera capture
// (AVFoundation on macOS, v4l2 on Linux).
func NewCamera() Camera { return &fakeCamera{} }

type fakeCamera struct{}

func (f *fakeCamera) Devices() ([]CameraDevice, error) {
	return []CameraDevice{
		{
			ID:          "fake-0",
			Name:        "Synthetic Camera 0 (gradient)",
			Description: "in-memory test pattern; no hardware required",
			Modes: []VideoMode{
				{Width: 320, Height: 240, Framerate: 15, PixelFmt: "mjpeg"},
				{Width: 640, Height: 480, Framerate: 15, PixelFmt: "mjpeg"},
				{Width: 1280, Height: 720, Framerate: 15, PixelFmt: "mjpeg"},
			},
		},
		{
			ID:          "fake-1",
			Name:        "Synthetic Camera 1 (stripes)",
			Description: "in-memory test pattern; no hardware required",
			Modes: []VideoMode{
				{Width: 640, Height: 480, Framerate: 15, PixelFmt: "mjpeg"},
			},
		},
	}, nil
}

func (f *fakeCamera) Open(ctx context.Context, opts CaptureOptions, out chan<- Frame) error {
	defer close(out)
	opts.applyDefaults()

	interval := time.Second / time.Duration(opts.Framerate)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	style := patternGradient
	if opts.DeviceID == "fake-1" {
		style = patternStripes
	}

	var seq uint64
	start := time.Now()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			seq++
			t := time.Since(start).Seconds()
			img := renderPattern(style, int(opts.Width), int(opts.Height), t)
			drawProgressBar(img, seq)
			buf := &bytes.Buffer{}
			if err := jpeg.Encode(buf, img, &jpeg.Options{Quality: int(opts.Quality)}); err != nil {
				return err
			}
			data := buf.Bytes()
			out <- Frame{
				Seq:        seq,
				CapturedAt: time.Now().UTC().Format(time.RFC3339Nano),
				Width:      opts.Width,
				Height:     opts.Height,
				Mime:       "image/jpeg",
				Data:       data,
				Size:       uint32(len(data)),
			}
		}
	}
}

type patternStyle int

const (
	patternGradient patternStyle = iota
	patternStripes
)

func renderPattern(style patternStyle, w, h int, t float64) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	switch style {
	case patternStripes:
		drawStripes(img, t)
	default:
		drawGradient(img, t)
	}
	return img
}

func drawGradient(img *image.RGBA, t float64) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	phase := t * 0.7
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			fx := float64(x) / float64(w)
			fy := float64(y) / float64(h)
			r := uint8(127 + 127*math.Sin(2*math.Pi*(fx+phase)))
			g := uint8(127 + 127*math.Sin(2*math.Pi*(fy+phase*0.5)))
			bl := uint8(127 + 127*math.Sin(2*math.Pi*(fx+fy+phase*1.3)))
			img.SetRGBA(x, y, color.RGBA{R: r, G: g, B: bl, A: 255})
		}
	}
}

func drawStripes(img *image.RGBA, t float64) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	offset := int(t*60) % 40
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			band := ((x + y + offset) / 20) % 6
			img.SetRGBA(x, y, stripeColors[band])
		}
	}
}

var stripeColors = [...]color.RGBA{
	{255, 255, 255, 255},
	{255, 255, 0, 255},
	{0, 255, 255, 255},
	{0, 255, 0, 255},
	{255, 0, 255, 255},
	{255, 0, 0, 255},
}

// drawProgressBar paints a thin moving indicator across the bottom of the
// image so the viewer can see frames are advancing without any text rendering.
func drawProgressBar(img *image.RGBA, seq uint64) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 10 || h < 10 {
		return
	}
	barH := 6
	y0 := h - barH - 4
	for y := y0; y < y0+barH; y++ {
		for x := 4; x < w-4; x++ {
			img.SetRGBA(x, y, color.RGBA{20, 20, 20, 255})
		}
	}
	pos := int(seq) % (w - 8)
	for y := y0; y < y0+barH; y++ {
		for x := pos; x < pos+24 && x < w-4; x++ {
			img.SetRGBA(x, y, color.RGBA{255, 255, 255, 255})
		}
	}
}
