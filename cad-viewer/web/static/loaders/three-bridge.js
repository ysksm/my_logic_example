// three.js bridge loader.
//
// Strategy: use three.js *only as a parser* for formats whose loaders Babylon
// doesn't ship (FBX / 3MF / Collada / 3DS / PLY). After parsing, we walk the
// resulting THREE.Object3D hierarchy, bake the world transform into vertex
// positions, and hand the flat TypedArrays to a Babylon `VertexData`. This
// lets us keep a single renderer (Babylon) while pulling in three.js's
// well-maintained loader ecosystem.
//
// Both three.js core and each loader module are loaded lazily on first use
// via dynamic import. The browser's import-map (declared in index.html)
// resolves bare specifiers like `three` and `three/addons/...`.

const LOADER_INFO = {
  ".fbx": {
    module: "three/addons/loaders/FBXLoader.js",
    className: "FBXLoader",
    inputType: "buffer",
  },
  ".3mf": {
    module: "three/addons/loaders/3MFLoader.js",
    className: "ThreeMFLoader",
    inputType: "buffer",
  },
  ".dae": {
    module: "three/addons/loaders/ColladaLoader.js",
    className: "ColladaLoader",
    inputType: "text",
  },
  ".3ds": {
    module: "three/addons/loaders/TDSLoader.js",
    className: "TDSLoader",
    inputType: "buffer",
  },
  ".ply": {
    module: "three/addons/loaders/PLYLoader.js",
    className: "PLYLoader",
    inputType: "buffer",
  },
};

let threeCorePromise = null;
const loaderModuleCache = {};

function getThree() {
  if (!threeCorePromise) {
    threeCorePromise = import("three").catch((err) => {
      threeCorePromise = null;
      throw err;
    });
  }
  return threeCorePromise;
}

async function getLoaderClass(ext) {
  const info = LOADER_INFO[ext];
  if (!info) throw new Error(`unsupported three.js extension: ${ext}`);
  if (!loaderModuleCache[ext]) {
    loaderModuleCache[ext] = import(info.module).catch((err) => {
      delete loaderModuleCache[ext];
      throw err;
    });
  }
  const mod = await loaderModuleCache[ext];
  const Cls = mod[info.className];
  if (!Cls) {
    throw new Error(
      `${info.className} not exported from ${info.module}`,
    );
  }
  return Cls;
}

export async function loadViaThree(file, ctx, ext) {
  const info = LOADER_INFO[ext];
  if (!info) throw new Error(`unsupported three.js extension: ${ext}`);

  const [THREE, LoaderCls] = await Promise.all([
    getThree(),
    getLoaderClass(ext),
  ]);

  const loader = new LoaderCls();
  let parsed;
  if (info.inputType === "text") {
    const text = await file.text();
    parsed = loader.parse(text, "");
  } else {
    const buffer = await file.arrayBuffer();
    parsed = loader.parse(buffer, "");
  }

  // Each loader's parse() returns a slightly different shape:
  //   FBXLoader / TDSLoader / 3MFLoader → THREE.Group
  //   ColladaLoader                      → { scene, animations, ... }
  //   PLYLoader                          → THREE.BufferGeometry
  let root;
  if (ext === ".dae") {
    root = parsed.scene;
  } else if (ext === ".ply") {
    const material = new THREE.MeshStandardMaterial();
    root = new THREE.Mesh(parsed, material);
  } else {
    root = parsed;
  }
  if (!root) throw new Error("loader returned no scene root");

  const meshes = convertHierarchy(THREE, root, ctx);
  if (meshes.length === 0) {
    throw new Error("ファイル内にメッシュが見つかりません");
  }

  let triangles = 0;
  let vertices = 0;
  for (const m of meshes) {
    const idx = m.getIndices();
    if (idx) triangles += idx.length / 3;
    vertices += m.getTotalVertices();
  }
  return {
    meshes,
    stats: {
      format: ext.replace(".", "").toUpperCase(),
      triangles,
      vertices,
    },
  };
}

// Walk a three.js Object3D and clone each Mesh into Babylon, baking the world
// transform into vertex positions so we don't have to reproduce the source
// hierarchy on the Babylon side.
function convertHierarchy(THREE, threeRoot, ctx) {
  threeRoot.updateMatrixWorld(true);
  const out = [];
  const tmp = new THREE.Vector3();

  threeRoot.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geo = node.geometry;
    const positionAttr = geo.attributes && geo.attributes.position;
    if (!positionAttr) return;

    const worldMatrix = node.matrixWorld;
    const positions = new Float32Array(positionAttr.count * 3);
    for (let i = 0; i < positionAttr.count; i++) {
      tmp.fromBufferAttribute(positionAttr, i).applyMatrix4(worldMatrix);
      positions[i * 3] = tmp.x;
      positions[i * 3 + 1] = tmp.y;
      positions[i * 3 + 2] = tmp.z;
    }

    const indexArr = geo.index ? Array.from(geo.index.array) : null;
    const indices = indexArr || (() => {
      const a = new Array(positionAttr.count);
      for (let i = 0; i < a.length; i++) a[i] = i;
      return a;
    })();

    let normals;
    if (geo.attributes.normal) {
      const nAttr = geo.attributes.normal;
      const nMat = new THREE.Matrix3().getNormalMatrix(worldMatrix);
      const arr = new Float32Array(nAttr.count * 3);
      for (let i = 0; i < nAttr.count; i++) {
        tmp.fromBufferAttribute(nAttr, i).applyMatrix3(nMat).normalize();
        arr[i * 3] = tmp.x;
        arr[i * 3 + 1] = tmp.y;
        arr[i * 3 + 2] = tmp.z;
      }
      normals = Array.from(arr);
    } else {
      normals = [];
      BABYLON.VertexData.ComputeNormals(
        Array.from(positions),
        indices,
        normals,
      );
    }

    const bMesh = new BABYLON.Mesh(node.name || "three-mesh", ctx.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = Array.from(positions);
    vd.normals = normals;
    vd.indices = indices;
    if (geo.attributes.uv) {
      vd.uvs = Array.from(geo.attributes.uv.array);
    }
    vd.applyToMesh(bMesh, true);

    const mat = ctx.makeDefaultMaterial();
    const tm = Array.isArray(node.material) ? node.material[0] : node.material;
    if (tm && tm.color) {
      mat.diffuseColor = new BABYLON.Color3(tm.color.r, tm.color.g, tm.color.b);
    }
    bMesh.material = mat;
    bMesh.parent = ctx.root;
    out.push(bMesh);
  });

  return out;
}
