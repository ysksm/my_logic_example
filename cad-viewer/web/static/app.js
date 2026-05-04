// CAD Viewer frontend entry.
//
// Owns the Babylon.js scene and dispatches each uploaded file to the matching
// loader from `./loaders/`. The loaders attach their meshes to a shared
// `modelRoot` TransformNode so disposal, bounding-box framing, and the
// wireframe toggle stay format-agnostic.

import { loaderFor, supportedExtensions } from "./loaders/index.js";

const canvas = document.getElementById("renderCanvas");
const fileInput = document.getElementById("file-input");
const sampleBtn = document.getElementById("sample-btn");
const resetBtn = document.getElementById("reset-btn");
const wireToggle = document.getElementById("wire-toggle");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

fileInput.setAttribute("accept", supportedExtensions.join(","));

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

new BABYLON.HemisphericLight(
  "hemi",
  new BABYLON.Vector3(0, 1, 0),
  scene,
).intensity = 0.7;
new BABYLON.DirectionalLight(
  "dir",
  new BABYLON.Vector3(-1, -2, -1),
  scene,
).intensity = 0.6;

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

let modelRoot = new BABYLON.TransformNode("modelRoot", scene);
let loadedMeshes = [];
let lastBounds = null;

function makeDefaultMaterial() {
  const mat = new BABYLON.StandardMaterial("model-mat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.85, 0.86, 0.9);
  mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.22);
  mat.backFaceCulling = false;
  mat.wireframe = wireToggle.checked;
  return mat;
}

const loaderContext = {
  scene,
  get root() {
    return modelRoot;
  },
  makeDefaultMaterial,
};

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function fmtVec(v) {
  return `[${v.map((n) => n.toFixed(3)).join(", ")}]`;
}

function setMeta(name, stats, bounds) {
  if (!stats) {
    metaEl.textContent = "";
    return;
  }
  const lines = [
    `name      : ${name}`,
    `format    : ${stats.format}`,
  ];
  if (typeof stats.triangles === "number") {
    lines.push(`triangles : ${Math.round(stats.triangles).toLocaleString()}`);
  }
  if (typeof stats.vertices === "number") {
    lines.push(`vertices  : ${Math.round(stats.vertices).toLocaleString()}`);
  }
  if (bounds) {
    lines.push(
      `bounds min: ${fmtVec(bounds.min)}`,
      `bounds max: ${fmtVec(bounds.max)}`,
      `size      : ${fmtVec(bounds.size)}`,
    );
  }
  metaEl.textContent = lines.join("\n");
}

function clearScene() {
  // Disposing the root cascades to all loaded meshes / nodes / materials.
  modelRoot.dispose(false, true);
  modelRoot = new BABYLON.TransformNode("modelRoot", scene);
  loadedMeshes = [];
  lastBounds = null;
}

function computeBoundsFromRoot() {
  // getHierarchyBoundingVectors walks every descendant mesh.
  const { min, max } = modelRoot.getHierarchyBoundingVectors(true);
  if (!isFinite(min.x) || !isFinite(max.x)) return null;
  const size = max.subtract(min);
  const center = min.add(max).scale(0.5);
  return {
    min: [min.x, min.y, min.z],
    max: [max.x, max.y, max.z],
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
    radius: BABYLON.Vector3.Distance(min, max) / 2,
  };
}

function frameCamera(bounds) {
  if (!bounds) return;
  const c = bounds.center;
  camera.target = new BABYLON.Vector3(c[0], c[1], c[2]);
  const r = Math.max(bounds.radius, 0.1);
  camera.radius = r * 3;
  camera.lowerRadiusLimit = r * 0.05;
  camera.upperRadiusLimit = r * 50;
  // Keep the floor grid visually relevant at any model scale.
  const span = Math.max(bounds.size[0], bounds.size[2], r * 2) * 4;
  grid.scaling = new BABYLON.Vector3(span / 200, 1, span / 200);
  grid.position.y = bounds.min[1];
}

function applyWireframe(on) {
  for (const m of loadedMeshes) {
    if (m.material) m.material.wireframe = on;
  }
}

async function loadFile(file) {
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  const loader = loaderFor(ext);
  if (!loader) {
    setStatus(
      `未対応の拡張子: ${ext} (対応: ${supportedExtensions.join(", ")})`,
      true,
    );
    return;
  }
  setStatus(`読み込み中: ${file.name} (${formatBytes(file.size)})`);
  metaEl.textContent = "";
  try {
    clearScene();
    const result = await loader(file, loaderContext, ext);
    loadedMeshes = result.meshes;
    applyWireframe(wireToggle.checked);
    lastBounds = computeBoundsFromRoot();
    frameCamera(lastBounds);
    setMeta(file.name, result.stats, lastBounds);
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
  if (file) loadFile(file);
});

sampleBtn.addEventListener("click", async () => {
  setStatus("サンプル読み込み中...");
  try {
    const res = await fetch("/samples/cube.stl");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await loadFile(new File([blob], "cube.stl", { type: "model/stl" }));
  } catch (err) {
    setStatus(`サンプル読み込み失敗: ${err.message}`, true);
  }
});

resetBtn.addEventListener("click", () => {
  if (lastBounds) frameCamera(lastBounds);
  else {
    camera.target = BABYLON.Vector3.Zero();
    camera.radius = 10;
  }
});

wireToggle.addEventListener("change", () => applyWireframe(wireToggle.checked));

window.addEventListener("resize", () => engine.resize());

// Drag & drop anywhere over the canvas.
const canvasWrap = document.getElementById("canvas-wrap");
canvasWrap.addEventListener("dragover", (e) => {
  e.preventDefault();
});
canvasWrap.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

engine.runRenderLoop(() => scene.render());
