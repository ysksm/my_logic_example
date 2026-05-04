// Babylon-native loader for glTF / GLB / OBJ.
//
// Babylon's SceneLoader plugins (bundled in babylonjs.loaders.min.js) accept
// a File object directly as the sceneFilename argument. We let it construct
// whatever hierarchy the source defines and just reparent the top-level
// nodes onto our common modelRoot so disposal and bbox computation stay
// uniform with the other loaders.

export async function loadBabylonAsset(file, ctx, ext) {
  const result = await BABYLON.SceneLoader.ImportMeshAsync(
    null,
    "",
    file,
    ctx.scene,
    null,
    ext,
  );

  // Reparent only the orphan roots (nodes with no parent of their own).
  // Inner hierarchy is preserved untouched.
  const reparented = [];
  for (const m of result.meshes) {
    if (!m.parent) {
      m.parent = ctx.root;
      reparented.push(m);
    }
  }
  for (const t of result.transformNodes || []) {
    if (!t.parent) {
      t.parent = ctx.root;
    }
  }

  // Normalize: meshes coming from glTF/OBJ may have a built-in material; if
  // not, attach our default. Make every loaded mesh respect the wireframe
  // toggle by using the same shared material when there's nothing else.
  for (const m of result.meshes) {
    if (!m.material && m.getTotalVertices && m.getTotalVertices() > 0) {
      m.material = ctx.makeDefaultMaterial();
    }
  }

  const triangles = result.meshes.reduce((sum, m) => {
    const idx = m.getIndices && m.getIndices();
    return idx ? sum + idx.length / 3 : sum;
  }, 0);
  const vertices = result.meshes.reduce(
    (sum, m) => sum + (m.getTotalVertices ? m.getTotalVertices() : 0),
    0,
  );

  return {
    meshes: result.meshes,
    stats: {
      format: ext.replace(".", "").toUpperCase(),
      triangles,
      vertices,
    },
  };
}
