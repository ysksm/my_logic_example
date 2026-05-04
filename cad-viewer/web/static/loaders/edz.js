// EDZ (EPLAN Data Portal archive) loader.
//
// EDZ files are ZIP archives produced by EPLAN tooling. They typically bundle
// XML symbol/attribute data along with one or more 3D part files (STEP / IGES,
// occasionally STL) referenced by the EPLAN macro. This loader unpacks the
// archive client-side with JSZip, picks the best-quality 3D entry, and
// delegates rendering to the matching loader sibling. EPLAN schematic data
// (.epj/.elk/.ema/...) is intentionally not handled — it's 2D electrical CAE,
// outside the scope of a 3D viewer.

import { loadOcct } from "./occt.js";
import { loadSTL } from "./stl.js";

const JSZIP_SRC = "/vendor/jszip/jszip.min.js";

// Priority order (best fidelity first). The loader picks the first match.
const PRIORITY = [".step", ".stp", ".iges", ".igs", ".stl"];

const INNER_LOADERS = {
  ".step": loadOcct,
  ".stp": loadOcct,
  ".iges": loadOcct,
  ".igs": loadOcct,
  ".stl": loadSTL,
};

let jszipPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error(`failed to load ${src}`)),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function getJSZip() {
  if (!jszipPromise) {
    jszipPromise = (async () => {
      if (window.JSZip) return window.JSZip;
      await loadScript(JSZIP_SRC);
      if (!window.JSZip) throw new Error("JSZip not initialized after load");
      return window.JSZip;
    })().catch((err) => {
      jszipPromise = null;
      throw err;
    });
  }
  return jszipPromise;
}

function extOf(path) {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i).toLowerCase();
}

export async function loadEDZ(file, ctx /*, ext */) {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const entries = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const e = extOf(path);
    if (PRIORITY.includes(e)) entries.push({ path, ext: e });
  });

  if (entries.length === 0) {
    throw new Error(
      "EDZ アーカイブに 3D ファイル (STEP/IGES/STL) が見つかりません",
    );
  }

  entries.sort(
    (a, b) =>
      PRIORITY.indexOf(a.ext) - PRIORITY.indexOf(b.ext) ||
      a.path.localeCompare(b.path),
  );

  if (entries.length > 1) {
    console.info(
      `[edz] ${entries.length} 個の 3D ファイル候補:`,
      entries.map((e) => e.path),
    );
  }

  const chosen = entries[0];
  const innerLoader = INNER_LOADERS[chosen.ext];
  if (!innerLoader) {
    throw new Error(`内部 3D ファイル形式が未対応: ${chosen.ext}`);
  }

  const blob = await zip.file(chosen.path).async("blob");
  const innerName = chosen.path.split("/").pop();
  const virtualFile = new File([blob], innerName, {
    type: "application/octet-stream",
  });

  const result = await innerLoader(virtualFile, ctx, chosen.ext);
  const label =
    entries.length > 1
      ? `EDZ → ${result.stats.format} (${chosen.path}, 候補 ${entries.length})`
      : `EDZ → ${result.stats.format} (${chosen.path})`;
  return {
    meshes: result.meshes,
    stats: { ...result.stats, format: label },
  };
}
