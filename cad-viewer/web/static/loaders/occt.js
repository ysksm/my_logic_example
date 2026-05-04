// STEP / IGES loader backed by occt-import-js (OpenCASCADE compiled to WASM).
//
// The 7.6 MB WASM blob is loaded lazily on the first STEP/IGES selection so
// users who only open STL or glTF don't pay for it. After parsing we hand the
// returned positions/normals/indices to a Babylon VertexData — the same path
// the STL loader takes — so framing, wireframe, etc. behave identically.

const OCCT_BASE = "/vendor/occt";
let occtPromise = null;

function loadOcctScript() {
  if (window.occtimportjs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-loader="occt-import-js"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("failed to load occt-import-js script")),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = `${OCCT_BASE}/occt-import-js.js`;
    s.dataset.loader = "occt-import-js";
    s.onload = () => resolve();
    s.onerror = () =>
      reject(new Error("failed to load occt-import-js script"));
    document.head.appendChild(s);
  });
}

function initOcct() {
  if (!occtPromise) {
    occtPromise = (async () => {
      await loadOcctScript();
      return window.occtimportjs({
        locateFile: (file) => `${OCCT_BASE}/${file}`,
      });
    })().catch((err) => {
      occtPromise = null; // allow retry next time
      throw err;
    });
  }
  return occtPromise;
}

const READERS = {
  ".step": "ReadStepFile",
  ".stp": "ReadStepFile",
  ".iges": "ReadIgesFile",
  ".igs": "ReadIgesFile",
};

const FORMAT_LABEL = {
  ".step": "STEP",
  ".stp": "STEP",
  ".iges": "IGES",
  ".igs": "IGES",
};

export async function loadOcct(file, ctx, ext) {
  const reader = READERS[ext];
  if (!reader) throw new Error(`unsupported OCCT extension: ${ext}`);

  const occt = await initOcct();
  const buffer = new Uint8Array(await file.arrayBuffer());
  const result = occt[reader](buffer, null);
  if (!result || !result.success) {
    throw new Error(`OCCT failed to read ${ext.toUpperCase()} file`);
  }
  if (!result.meshes || result.meshes.length === 0) {
    throw new Error("file parsed but contained no tessellated geometry");
  }

  const meshes = [];
  let totalTri = 0;
  let totalVert = 0;

  for (const m of result.meshes) {
    const positions = m.attributes && m.attributes.position
      ? m.attributes.position.array
      : null;
    const indices = m.index ? m.index.array : null;
    if (!positions || !indices) continue;

    const mesh = new BABYLON.Mesh(m.name || "occt-mesh", ctx.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    if (m.attributes && m.attributes.normal) {
      vd.normals = m.attributes.normal.array;
    } else {
      const normals = [];
      BABYLON.VertexData.ComputeNormals(positions, indices, normals);
      vd.normals = normals;
    }
    vd.applyToMesh(mesh, true);

    const mat = ctx.makeDefaultMaterial();
    if (m.color && m.color.length >= 3) {
      mat.diffuseColor = new BABYLON.Color3(m.color[0], m.color[1], m.color[2]);
    }
    mesh.material = mat;
    mesh.parent = ctx.root;
    meshes.push(mesh);

    totalTri += indices.length / 3;
    totalVert += positions.length / 3;
  }

  if (meshes.length === 0) {
    throw new Error("no usable meshes extracted");
  }

  return {
    meshes,
    stats: {
      format: FORMAT_LABEL[ext],
      triangles: totalTri,
      vertices: totalVert,
    },
  };
}
