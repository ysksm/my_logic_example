// STL loader: posts the file to the Go backend and converts the returned
// renderer-agnostic mesh payload into a Babylon mesh. STL parsing lives in
// Go because it's CPU-bound and we get free server-side reuse for free.

export async function loadSTL(file, ctx) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/cad/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const payload = await res.json();

  const mesh = new BABYLON.Mesh(payload.name || "model", ctx.scene);
  const vd = new BABYLON.VertexData();
  vd.positions = payload.positions;
  vd.normals = payload.normals;
  vd.indices = payload.indices;
  vd.applyToMesh(mesh, true);
  mesh.material = ctx.makeDefaultMaterial();
  mesh.parent = ctx.root;

  return {
    meshes: [mesh],
    stats: {
      format: "STL",
      triangles: payload.triangles,
      vertices: payload.positions.length / 3,
    },
  };
}
