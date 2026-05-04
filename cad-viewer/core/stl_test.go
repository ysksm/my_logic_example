package core

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

func TestParseASCIISTL_Tetrahedron(t *testing.T) {
	src := `solid tetra
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
facet normal 0 0 -1
  outer loop
    vertex 0 0 0
    vertex 0 1 0
    vertex 0 0 1
  endloop
endfacet
endsolid tetra
`
	mesh, err := ParseSTL("tetra", []byte(src))
	if err != nil {
		t.Fatalf("ParseSTL: %v", err)
	}
	if mesh.Triangles != 2 {
		t.Fatalf("triangles = %d, want 2", mesh.Triangles)
	}
	if len(mesh.Positions) != 18 {
		t.Fatalf("positions len = %d, want 18", len(mesh.Positions))
	}
	if len(mesh.Indices) != 6 {
		t.Fatalf("indices len = %d, want 6", len(mesh.Indices))
	}
	if mesh.Bounds.Max[0] != 1 || mesh.Bounds.Max[1] != 1 || mesh.Bounds.Max[2] != 1 {
		t.Fatalf("bounds.max = %v, want {1,1,1}", mesh.Bounds.Max)
	}
}

func TestParseBinarySTL_Triangle(t *testing.T) {
	var buf bytes.Buffer
	header := make([]byte, 80)
	buf.Write(header)
	binary.Write(&buf, binary.LittleEndian, uint32(1))
	floats := []float32{
		0, 0, 1, // normal
		0, 0, 0,
		1, 0, 0,
		0, 1, 0,
	}
	for _, f := range floats {
		binary.Write(&buf, binary.LittleEndian, f)
	}
	binary.Write(&buf, binary.LittleEndian, uint16(0))

	mesh, err := ParseSTL("tri", buf.Bytes())
	if err != nil {
		t.Fatalf("ParseSTL: %v", err)
	}
	if mesh.Triangles != 1 {
		t.Fatalf("triangles = %d, want 1", mesh.Triangles)
	}
	if mesh.Normals[2] != 1 {
		t.Fatalf("normal z = %v, want 1", mesh.Normals[2])
	}
}

func TestParseSTL_Invalid(t *testing.T) {
	if _, err := ParseSTL("x", []byte("nope")); err == nil {
		t.Fatal("expected error on garbage input")
	}
	if _, err := ParseSTL("x", []byte(strings.Repeat("solid empty\n", 1))); err == nil {
		t.Fatal("expected error on empty solid")
	}
}
