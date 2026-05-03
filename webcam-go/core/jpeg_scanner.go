package core

import (
	"bufio"
	"bytes"
	"errors"
	"io"
)

// jpegScanner reads a concatenated JPEG byte stream (an MJPEG payload) and
// yields one complete JPEG per call to Next(). It works by scanning for the
// SOI marker (0xFFD8) and the EOI marker (0xFFD9), and returning the bytes
// in between (inclusive of both markers).
//
// The scanner is intentionally tolerant of arbitrary garbage between frames,
// which is useful when ffmpeg stderr leaks into stdout under unusual settings.
type jpegScanner struct {
	r       *bufio.Reader
	buf     bytes.Buffer
	maxSize int
}

func newJPEGScanner(r io.Reader) *jpegScanner {
	return &jpegScanner{
		r:       bufio.NewReaderSize(r, 64<<10),
		maxSize: 32 << 20, // 32 MiB hard cap per frame
	}
}

func (s *jpegScanner) Next() ([]byte, error) {
	// 1) Discard bytes until we find the SOI marker (FF D8).
	if err := s.scanTo(0xFF, 0xD8); err != nil {
		return nil, err
	}
	s.buf.Reset()
	s.buf.WriteByte(0xFF)
	s.buf.WriteByte(0xD8)

	// 2) Read until we find the EOI marker (FF D9).
	for {
		b, err := s.r.ReadByte()
		if err != nil {
			return nil, err
		}
		s.buf.WriteByte(b)
		if s.buf.Len() > s.maxSize {
			return nil, errors.New("jpeg frame exceeds max size")
		}
		if b == 0xFF {
			next, err := s.r.ReadByte()
			if err != nil {
				return nil, err
			}
			s.buf.WriteByte(next)
			if next == 0xD9 {
				out := make([]byte, s.buf.Len())
				copy(out, s.buf.Bytes())
				return out, nil
			}
		}
	}
}

// scanTo discards bytes from r until the two-byte sequence (a, b) is found,
// after which the position is just past those two bytes (which the caller is
// expected to re-emit if they are part of the desired output).
func (s *jpegScanner) scanTo(a, b byte) error {
	prev := byte(0)
	hasPrev := false
	for {
		c, err := s.r.ReadByte()
		if err != nil {
			return err
		}
		if hasPrev && prev == a && c == b {
			return nil
		}
		prev = c
		hasPrev = true
	}
}
