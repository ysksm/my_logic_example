// CAD Viewer frontend.
//
// Architecture: this file owns the Babylon.js scene and talks to the Go
// backend over plain HTTP. The backend parses CAD files and returns a
// renderer-agnostic mesh payload (positions / normals / indices); this client
// pushes it into a Babylon `VertexData`. The same JS runs unchanged whether
// the server is `cad-viewer serve` or the embedded Wails AssetServer.

const canvas = document.getElementById("renderCanvas");
const fileInput = document.getElementById("file-input");
const sampleBtn = document.getElementById("sample-btn");
const resetBtn = document.getElementById("reset-btn");
const wireToggle = document.getElementById("wire-toggle");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
});

const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.05, 0.07, 0.09, 1);

const camera = new BABYLON.ArcRotateCamera(
  "camera",
  -Math.PI / 4,
  Math.PI / 3,
  10,
  BABYLON.Vector3.Zero(),
  scene,
);
camera.attachControl(canvas, true);
camera.wheelDeltaPercentage = 0.01;
camera.lowerRadiusLimit = 0.01;
camera.minZ = 0.01;

const hemi = new BABYLON.HemisphericLight(
  "hemi",
  new BABYLON.Vector3(0, 1, 0),
  scene,
);
hemi.intensity = 0.7;
const dir = new BABYLON.DirectionalLight(
  "dir",
  new BABYLON.Vector3(-1, -2, -1),
  scene,
);
dir.intensity = 0.6;

const grid = BABYLON.MeshBuilder.CreateGround(
  "grid",
  { width: 200, height: 200, subdivisions: 1 },
  scene,
);
const gridMat = new BABYLON.StandardMaterial("gridMat", scene);
gridMat.diffuseColor = new BABYLON.Color3(0.12, 0.14, 0.17);
gridMat.specularColor = new BABYLON.Color3(0, 0, 0);
gridMat.wireframe = true;
grid.material = gridMat;
grid.isPickable = false;

let currentMesh = null;
let currentBounds = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function setMeta(mesh) {
  if (!mesh) {
    metaEl.textContent = "";
    return;
  }
  const b = mesh.bounds;
  metaEl.textContent =
    `name      : ${mesh.name}\n` +
    `triangles : ${mesh.triangles.toLocaleString()}\n` +
    `vertices  : ${(mesh.positions.length / 3).toLocaleString()}\n` +
    `bounds min: ${fmtVec(b.min)}\n` +
    `bounds max: ${fmtVec(b.max)}\n` +
    `size      : ${fmtVec(b.size)}`;
}

function fmtVec(v) {
  return `[${v.map((n) => n.toFixed(3)).join(", ")}]`;
}

function disposeCurrent() {
  if (currentMesh) {
    currentMesh.dispose();
    currentMesh = null;
  }
}

function loadMesh(payload) {
  disposeCurrent();

  const mesh = new BABYLON.Mesh(payload.name || "model", scene);
  const vd = new BABYLON.VertexData();
  vd.positions = payload.positions;
  vd.normals = payload.normals;
  vd.indices = payload.indices;
  vd.applyToMesh(mesh, true);

  const mat = new BABYLON.StandardMaterial("model-mat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.85, 0.86, 0.9);
  mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.22);
  mat.backFaceCulling = false;
  mat.wireframe = wireToggle.checked;
  mesh.material = mat;

  currentMesh = mesh;
  currentBounds = payload.bounds;
  frameCamera(payload.bounds);
  setMeta(payload);
}

function frameCamera(bounds) {
  if (!bounds) return;
  const c = bounds.center;
  camera.target = new BABYLON.Vector3(c[0], c[1], c[2]);
  const r = Math.max(bounds.radius, 0.1);
  camera.radius = r * 3;
  camera.lowerRadiusLimit = r * 0.05;
  camera.upperRadiusLimit = r * 50;

  // Resize the floor grid to roughly fit the model footprint so it stays
  // useful as a spatial reference at any scale.
  const span = Math.max(bounds.size[0], bounds.size[2], r * 2) * 4;
  grid.scaling = new BABYLON.Vector3(
    span / 200,
    1,
    span / 200,
  );
  grid.position.y = bounds.min[1];
}

async function uploadFile(file) {
  setStatus(`読み込み中: ${file.name} (${formatBytes(file.size)})`);
  metaEl.textContent = "";
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/cad/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const payload = await res.json();
    loadMesh(payload);
    setStatus(`読み込み完了: ${file.name}`);
  } catch (err) {
    setStatus(`読み込みに失敗しました: ${err.message}`, true);
    console.error(err);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) uploadFile(file);
});

sampleBtn.addEventListener("click", async () => {
  setStatus("サンプル読み込み中...");
  try {
    const res = await fetch("/samples/cube.stl");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await uploadFile(new File([blob], "cube.stl", { type: "model/stl" }));
  } catch (err) {
    setStatus(`サンプル読み込み失敗: ${err.message}`, true);
  }
});

resetBtn.addEventListener("click", () => {
  if (currentBounds) frameCamera(currentBounds);
  else {
    camera.target = BABYLON.Vector3.Zero();
    camera.radius = 10;
  }
});

wireToggle.addEventListener("change", () => {
  if (currentMesh && currentMesh.material) {
    currentMesh.material.wireframe = wireToggle.checked;
  }
});

window.addEventListener("resize", () => engine.resize());

engine.runRenderLoop(() => scene.render());
