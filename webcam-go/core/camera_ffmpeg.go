//go:build ffmpeg

package core

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// NewCamera returns a Camera backed by the system `ffmpeg` binary.
//
// On macOS this uses the AVFoundation input device (built-in camera, USB
// cameras, virtual cameras). On Linux it uses v4l2 against /dev/videoN.
// On other platforms or when ffmpeg is missing, Devices() returns an error.
func NewCamera() Camera { return &ffmpegCamera{} }

type ffmpegCamera struct{}

func (c *ffmpegCamera) Devices() ([]CameraDevice, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, fmt.Errorf("ffmpeg not found in PATH: %w", err)
	}
	switch runtime.GOOS {
	case "darwin":
		return listDevicesAVFoundation()
	case "linux":
		return listDevicesV4L2()
	default:
		return nil, fmt.Errorf("unsupported platform for ffmpeg camera: %s", runtime.GOOS)
	}
}

func (c *ffmpegCamera) Open(ctx context.Context, opts CaptureOptions, out chan<- Frame) error {
	defer close(out)
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return fmt.Errorf("ffmpeg not found in PATH: %w", err)
	}
	opts.applyDefaults()

	args, err := ffmpegArgs(opts)
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	// Drain stderr so the ffmpeg pipe doesn't fill and stall.
	go io.Copy(io.Discard, stderr)

	scanner := newJPEGScanner(stdout)
	var seq uint64
	for {
		jpegBytes, err := scanner.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			_ = cmd.Process.Kill()
			return err
		}
		seq++
		out <- Frame{
			Seq:        seq,
			CapturedAt: time.Now().UTC().Format(time.RFC3339Nano),
			Width:      opts.Width,
			Height:     opts.Height,
			Mime:       "image/jpeg",
			Data:       jpegBytes,
			Size:       uint32(len(jpegBytes)),
		}
	}

	if err := cmd.Wait(); err != nil && ctx.Err() == nil {
		return err
	}
	return nil
}

func ffmpegArgs(opts CaptureOptions) ([]string, error) {
	common := []string{
		"-loglevel", "error",
		"-framerate", strconv.Itoa(int(opts.Framerate)),
		"-video_size", fmt.Sprintf("%dx%d", opts.Width, opts.Height),
	}
	switch runtime.GOOS {
	case "darwin":
		args := append([]string{"-f", "avfoundation"}, common...)
		args = append(args, "-i", opts.DeviceID)
		args = append(args,
			"-f", "mjpeg",
			"-q:v", jpegQscale(opts.Quality),
			"-",
		)
		return args, nil
	case "linux":
		args := append([]string{"-f", "v4l2"}, common...)
		args = append(args, "-i", opts.DeviceID)
		args = append(args,
			"-f", "mjpeg",
			"-q:v", jpegQscale(opts.Quality),
			"-",
		)
		return args, nil
	default:
		return nil, fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}

// jpegQscale maps a 1..100 quality (higher = better) to ffmpeg's MJPEG qscale
// 2..31 (lower = better).
func jpegQscale(q uint32) string {
	if q == 0 {
		q = 75
	}
	if q > 100 {
		q = 100
	}
	scale := 2 + (100-int(q))*29/100
	return strconv.Itoa(scale)
}

// ---------- AVFoundation device listing (macOS) ----------

var avfDeviceLine = regexp.MustCompile(`^\[AVFoundation [^\]]+\]\s+\[(\d+)\]\s+(.+)$`)

func listDevicesAVFoundation() ([]CameraDevice, error) {
	cmd := exec.Command("ffmpeg",
		"-hide_banner",
		"-f", "avfoundation",
		"-list_devices", "true",
		"-i", "",
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	_ = cmd.Run() // ffmpeg exits non-zero after listing; ignore.

	var devices []CameraDevice
	video := false
	scanner := bufio.NewScanner(&stderr)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.Contains(line, "AVFoundation video devices"):
			video = true
		case strings.Contains(line, "AVFoundation audio devices"):
			video = false
		default:
			if !video {
				continue
			}
			m := avfDeviceLine.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			devices = append(devices, CameraDevice{
				ID:          m[1],
				Name:        strings.TrimSpace(m[2]),
				Description: "AVFoundation video device",
			})
		}
	}
	return devices, nil
}

// ---------- v4l2 device listing (Linux) ----------

func listDevicesV4L2() ([]CameraDevice, error) {
	matches, _ := filepath.Glob("/dev/video*")
	devices := make([]CameraDevice, 0, len(matches))
	for _, path := range matches {
		devices = append(devices, CameraDevice{
			ID:          path,
			Name:        path,
			Description: "v4l2 video device",
		})
	}
	return devices, nil
}
