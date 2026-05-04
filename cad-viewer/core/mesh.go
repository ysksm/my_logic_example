package core

import "math"

// Vec3 is a 3D vector encoded as [x, y, z].
type Vec3 = [3]float32

// Mesh is the renderer-agnostic representation of a parsed CAD model.
//
// The layout matches what Babylon.js (and most WebGL stacks) expect for a
// VertexData object: flat float arrays plus a flat int index array. We keep
// per-face normals so flat-shaded models render correctly without the client
// having to recompute them.
type Mesh struct {
	Name      string  `json:"name"`
	Positions []float32 `json:"positions"`
	Normals   []float32 `json:"normals"`
	Indices   []uint32  `json:"indices"`
	Bounds    Bounds  `json:"bounds"`
	Triangles int     `json:"triangles"`
}

// Bounds describes the axis-aligned bounding box of a mesh.
type Bounds struct {
	Min    Vec3    `json:"min"`
	Max    Vec3    `json:"max"`
	Center Vec3    `json:"center"`
	Size   Vec3    `json:"size"`
	Radius float32 `json:"radius"`
}

// Triangle is the intermediate representation produced by file-format parsers.
// Converting to Mesh is done by FromTriangles.
type Triangle struct {
	Normal   Vec3
	Vertices [3]Vec3
}

// FromTriangles converts a slice of triangles into a renderable Mesh.
//
// Vertices are not deduplicated: each triangle contributes three unique
// positions so flat shading is preserved. This keeps the parser simple and
// matches the on-wire STL representation.
func FromTriangles(name string, tris []Triangle) Mesh {
	positions := make([]float32, 0, len(tris)*9)
	normals := make([]float32, 0, len(tris)*9)
	indices := make([]uint32, 0, len(tris)*3)

	for i, t := range tris {
		n := t.Normal
		if isZero(n) {
			n = computeNormal(t.Vertices[0], t.Vertices[1], t.Vertices[2])
		}
		for _, v := range t.Vertices {
			positions = append(positions, v[0], v[1], v[2])
			normals = append(normals, n[0], n[1], n[2])
		}
		base := uint32(i) * 3
		indices = append(indices, base, base+1, base+2)
	}

	return Mesh{
		Name:      name,
		Positions: positions,
		Normals:   normals,
		Indices:   indices,
		Bounds:    computeBounds(positions),
		Triangles: len(tris),
	}
}

func computeNormal(a, b, c Vec3) Vec3 {
	ux, uy, uz := b[0]-a[0], b[1]-a[1], b[2]-a[2]
	vx, vy, vz := c[0]-a[0], c[1]-a[1], c[2]-a[2]
	nx := uy*vz - uz*vy
	ny := uz*vx - ux*vz
	nz := ux*vy - uy*vx
	l := float32(math.Sqrt(float64(nx*nx + ny*ny + nz*nz)))
	if l == 0 {
		return Vec3{0, 0, 0}
	}
	return Vec3{nx / l, ny / l, nz / l}
}

func isZero(v Vec3) bool {
	return v[0] == 0 && v[1] == 0 && v[2] == 0
}

func computeBounds(positions []float32) Bounds {
	if len(positions) == 0 {
		return Bounds{}
	}
	min := Vec3{positions[0], positions[1], positions[2]}
	max := min
	for i := 3; i < len(positions); i += 3 {
		x, y, z := positions[i], positions[i+1], positions[i+2]
		if x < min[0] {
			min[0] = x
		}
		if y < min[1] {
			min[1] = y
		}
		if z < min[2] {
			min[2] = z
		}
		if x > max[0] {
			max[0] = x
		}
		if y > max[1] {
			max[1] = y
		}
		if z > max[2] {
			max[2] = z
		}
	}
	size := Vec3{max[0] - min[0], max[1] - min[1], max[2] - min[2]}
	center := Vec3{(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2}
	radius := float32(math.Sqrt(float64(size[0]*size[0]+size[1]*size[1]+size[2]*size[2]))) / 2
	return Bounds{Min: min, Max: max, Center: center, Size: size, Radius: radius}
}
