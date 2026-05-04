package core

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

// ErrInvalidSTL is returned when input bytes cannot be interpreted as STL.
var ErrInvalidSTL = errors.New("invalid STL data")

// ParseSTL detects the STL format (ASCII vs. binary) and dispatches.
//
// Detection follows the conventional approach: an ASCII STL must start with
// "solid" and contain "facet" within its body. A file that begins with "solid"
// but is binary in practice is still detected by checking the trailing facet
// keyword presence.
func ParseSTL(name string, data []byte) (Mesh, error) {
	if len(data) < 15 {
		return Mesh{}, fmt.Errorf("%w: too short", ErrInvalidSTL)
	}
	if isASCIISTL(data) {
		tris, err := parseASCIISTL(data)
		if err != nil {
			return Mesh{}, err
		}
		return FromTriangles(name, tris), nil
	}
	tris, err := parseBinarySTL(data)
	if err != nil {
		return Mesh{}, err
	}
	return FromTriangles(name, tris), nil
}

func isASCIISTL(data []byte) bool {
	head := bytes.TrimLeft(data[:min(len(data), 256)], " \t\r\n")
	if !bytes.HasPrefix(bytes.ToLower(head), []byte("solid")) {
		return false
	}
	probe := data
	if len(probe) > 1024 {
		probe = probe[:1024]
	}
	return bytes.Contains(bytes.ToLower(probe), []byte("facet"))
}

func parseASCIISTL(data []byte) ([]Triangle, error) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	var tris []Triangle
	var current Triangle
	vertexIdx := 0
	inFacet := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		switch strings.ToLower(fields[0]) {
		case "facet":
			if len(fields) >= 5 && strings.EqualFold(fields[1], "normal") {
				n, err := parseVec3(fields[2:5])
				if err != nil {
					return nil, fmt.Errorf("%w: bad normal: %v", ErrInvalidSTL, err)
				}
				current = Triangle{Normal: n}
				vertexIdx = 0
				inFacet = true
			}
		case "vertex":
			if !inFacet || vertexIdx >= 3 {
				return nil, fmt.Errorf("%w: unexpected vertex", ErrInvalidSTL)
			}
			if len(fields) < 4 {
				return nil, fmt.Errorf("%w: vertex missing coords", ErrInvalidSTL)
			}
			v, err := parseVec3(fields[1:4])
			if err != nil {
				return nil, fmt.Errorf("%w: bad vertex: %v", ErrInvalidSTL, err)
			}
			current.Vertices[vertexIdx] = v
			vertexIdx++
		case "endfacet":
			if vertexIdx != 3 {
				return nil, fmt.Errorf("%w: facet has %d vertices", ErrInvalidSTL, vertexIdx)
			}
			tris = append(tris, current)
			inFacet = false
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(tris) == 0 {
		return nil, fmt.Errorf("%w: no triangles", ErrInvalidSTL)
	}
	return tris, nil
}

func parseVec3(fields []string) (Vec3, error) {
	if len(fields) < 3 {
		return Vec3{}, errors.New("need 3 floats")
	}
	var out Vec3
	for i := 0; i < 3; i++ {
		f, err := strconv.ParseFloat(fields[i], 32)
		if err != nil {
			return Vec3{}, err
		}
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return Vec3{}, fmt.Errorf("non-finite value")
		}
		out[i] = float32(f)
	}
	return out, nil
}

// Binary STL layout: 80-byte header, uint32 count, then count * 50 bytes of
// (normal float32x3, vertices float32x9, attribute byte count uint16).
const (
	binaryHeaderSize = 80
	binaryRecordSize = 50
)

func parseBinarySTL(data []byte) ([]Triangle, error) {
	if len(data) < binaryHeaderSize+4 {
		return nil, fmt.Errorf("%w: binary header truncated", ErrInvalidSTL)
	}
	r := bytes.NewReader(data)
	if _, err := r.Seek(binaryHeaderSize, io.SeekStart); err != nil {
		return nil, err
	}
	var count uint32
	if err := binary.Read(r, binary.LittleEndian, &count); err != nil {
		return nil, fmt.Errorf("%w: read count: %v", ErrInvalidSTL, err)
	}
	expected := int64(binaryHeaderSize) + 4 + int64(count)*binaryRecordSize
	if int64(len(data)) < expected {
		return nil, fmt.Errorf("%w: expected %d bytes, got %d", ErrInvalidSTL, expected, len(data))
	}
	tris := make([]Triangle, count)
	for i := uint32(0); i < count; i++ {
		var rec struct {
			NX, NY, NZ          float32
			V0X, V0Y, V0Z       float32
			V1X, V1Y, V1Z       float32
			V2X, V2Y, V2Z       float32
			AttributeByteCount  uint16
		}
		if err := binary.Read(r, binary.LittleEndian, &rec); err != nil {
			return nil, fmt.Errorf("%w: read facet %d: %v", ErrInvalidSTL, i, err)
		}
		tris[i] = Triangle{
			Normal: Vec3{rec.NX, rec.NY, rec.NZ},
			Vertices: [3]Vec3{
				{rec.V0X, rec.V0Y, rec.V0Z},
				{rec.V1X, rec.V1Y, rec.V1Z},
				{rec.V2X, rec.V2Y, rec.V2Z},
			},
		}
	}
	if len(tris) == 0 {
		return nil, fmt.Errorf("%w: no triangles", ErrInvalidSTL)
	}
	return tris, nil
}
