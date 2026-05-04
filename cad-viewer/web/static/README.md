# cad-viewer frontend

Babylon.js による 3D レンダリング層。バックエンドの Go 製 HTTP API と、
Wails AssetServer のどちらからでも同じコードがそのまま動く。

## レイヤ

- `index.html` / `style.css` — シェルとスタイル
- `app.js` — シーン構築、UI イベント、ローダ呼び出し (エントリ)
- `loaders/` — ファイル形式ごとのローダ。すべて
  `(file, ctx) => Promise<{ root, stats, bounds }>` を返す薄い純関数。
  - `stl.js` — Go バックエンド (`/api/cad/upload`) に投げて VertexData を受け取る
  - `babylon.js` — glTF / GLB / OBJ を `BABYLON.SceneLoader` でクライアント側読込
  - `occt.js` — STEP / IGES を `occt-import-js` (WASM) でクライアント側読込
- `loaders/index.js` — 拡張子→ローダ のレジストリ

新しい形式を足すときは `loaders/<format>.js` を作り、`index.js` の
レジストリに 1 行追加するだけ。
