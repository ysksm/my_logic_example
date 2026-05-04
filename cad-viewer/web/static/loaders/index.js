// Loader registry. Maps a lowercase file extension (with dot) to a loader.
//
// Each loader has the signature:
//   (file: File, ctx: LoaderContext, ext: string) => Promise<{
//     meshes: BABYLON.AbstractMesh[],
//     stats: { format: string, triangles?: number, vertices?: number },
//   }>
//
// LoaderContext (provided by app.js):
//   - scene:               BABYLON.Scene
//   - root:                BABYLON.TransformNode (parent for loaded nodes)
//   - makeDefaultMaterial: () => BABYLON.Material

import { loadSTL } from "./stl.js";
import { loadBabylonAsset } from "./babylon.js";
import { loadOcct } from "./occt.js";
import { loadEDZ } from "./edz.js";

export const loaders = {
  ".stl": loadSTL,
  ".gltf": loadBabylonAsset,
  ".glb": loadBabylonAsset,
  ".obj": loadBabylonAsset,
  ".step": loadOcct,
  ".stp": loadOcct,
  ".iges": loadOcct,
  ".igs": loadOcct,
  ".edz": loadEDZ,
};

export const supportedExtensions = Object.keys(loaders);

export function loaderFor(ext) {
  return loaders[ext.toLowerCase()] || null;
}
