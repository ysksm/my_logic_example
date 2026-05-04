# cad-viewer

Go バックエンド + Babylon.js フロントエンドの CAD ビューア。**1 つのコードベース** から Web サーバとしても、Wails デスクトップアプリとしても起動できます。

## アーキテクチャ

```
                 ┌────────────────────────────┐
                 │  Babylon.js (web/static)   │  ← フロントエンドはこの一式だけ
                 │  index.html / app.js       │
                 └──────────────┬─────────────┘
                                │ HTTP (REST + 静的配信)
                ┌───────────────▼───────────────┐
                │  web.Server  (http.Handler)   │  ← 共通の HTTP ルータ
                │  - GET  /                     │
                │  - GET  /samples/...          │
                │  - POST /api/cad/upload       │
                └──────┬──────────────────┬─────┘
                       │                  │
        ┌──────────────▼──┐         ┌─────▼─────────────────────┐
        │  cli serve      │         │  cli desktop  (-tags dev) │
        │  net/http で    │         │  Wails が AssetServer に  │
        │  リッスン       │         │  同じ Handler を装着      │
        └─────────────────┘         └───────────────────────────┘

                       ┌──────────────────┐
                       │   core           │
                       │   - Mesh / Bounds│  ← レンダラ非依存ドメイン
                       │   - STL parser   │
                       └──────────────────┘
```

ポイント:

- **共通ハンドラ**: `web.Server.Handler()` が返す `http.Handler` を、ローカル
  HTTP サーバと Wails の `AssetServer` の両方が利用するため、Web 版とデス
  クトップ版でフロントエンド／API が完全に同じになります。
- **ビルドタグでデスクトップ依存を分離**: Wails / cgo が必要なのは
  `desktop` パッケージと `cli/desktop.go` のみで、いずれも `dev` か
  `production` タグでガードされています。タグなしの `go build` は cgo 不要
  の軽量 Web バイナリを生成します。
- **レンダラ非依存ドメイン**: STL のパースは `core` 内で完結し、出力は
  Babylon.js の `VertexData` にそのまま流せる JSON 形（positions / normals /
  indices + bounds）です。別形式（OBJ / glTF など）を追加する際は `core`
  にパーサを足し、`web/handlers.go` の `parseByExtension` に拡張子を 1 行
  追加するだけで済みます。

## ディレクトリ構成

```
cad-viewer/
├── main.go            // エントリポイント
├── go.mod
├── Makefile
├── core/              // ドメイン（メッシュ / STL パーサ / 設定）
│   ├── config.go
│   ├── mesh.go
│   ├── stl.go
│   └── stl_test.go
├── web/               // HTTP サーバ + 埋め込みフロントエンド
│   ├── server.go
│   ├── handlers.go
│   └── static/        // Babylon.js のフロント一式（embed される）
│       ├── index.html
│       ├── app.js
│       ├── style.css
│       └── samples/cube.stl
├── desktop/           // Wails ラッパ（dev / production タグ）
│   └── app.go
└── cli/               // Cobra コマンド
    ├── root.go
    ├── serve.go
    ├── desktop.go      // dev / production タグ
    └── desktop_stub.go // タグなし時のフォールバック
```

## 使い方

### Web モード

```sh
make dev          # localhost:8080 をブラウザで開く
# または
go run . serve --addr :8080 --open
```

ブラウザで「STL ファイルを開く」を押すか、`.stl` をドラッグ＆ドロップして
読み込んでください。サンプル用のキューブも同梱しています。

### デスクトップ（Wails）モード

```sh
# 開発実行
make desktop
# 本番ビルド
make build-desktop
```

> Wails の前提条件（cgo ツールチェーン、各 OS の WebView ランタイム等）が
> 必要です。詳しくは https://wails.io を参照。

### テスト

```sh
make test
```

## 対応フォーマット

| 拡張子 | 形式 | パース場所 | 実装 |
|---|---|---|---|
| `.stl` | STL ASCII / Binary | サーバ (Go) | `core/stl.go` |
| `.gltf` / `.glb` | glTF 2.0 | クライアント (Babylon.js Loader) | `web/static/loaders/babylon.js` |
| `.obj` | Wavefront OBJ | クライアント (Babylon.js Loader) | `web/static/loaders/babylon.js` |
| `.step` / `.stp` | STEP (ISO 10303) | クライアント (OpenCASCADE/WASM) | `web/static/loaders/occt.js` |
| `.iges` / `.igs` | IGES | クライアント (OpenCASCADE/WASM) | `web/static/loaders/occt.js` |
| `.fbx` | Autodesk FBX | クライアント (three.js → Babylon ブリッジ) | `web/static/loaders/three-bridge.js` |
| `.3mf` | 3D Manufacturing Format | クライアント (three.js → Babylon ブリッジ) | `web/static/loaders/three-bridge.js` |
| `.dae` | COLLADA | クライアント (three.js → Babylon ブリッジ) | `web/static/loaders/three-bridge.js` |
| `.3ds` | Autodesk 3D Studio | クライアント (three.js → Babylon ブリッジ) | `web/static/loaders/three-bridge.js` |
| `.ply` | Stanford PLY | クライアント (three.js → Babylon ブリッジ) | `web/static/loaders/three-bridge.js` |
| `.edz` | EPLAN Data Portal アーカイブ (中の 3D を抽出) | クライアント (JSZip → OCCT/STL) | `web/static/loaders/edz.js` |

クライアント側依存ライブラリ (すべてリポジトリに同梱済み、`make vendor-js` で更新):

- `web/static/vendor/occt/occt-import-js.{js,wasm}` 約 7.6 MB — STEP / IGES
- `web/static/vendor/jszip/jszip.min.js` 約 95 KB — EDZ
- `web/static/vendor/three/` 約 1.7 MB — FBX / 3MF / DAE / 3DS / PLY 用の three.js コア + 各 Loader (公式 `examples/jsm/`)

依存はすべて初回利用時に**動的 import される遅延読込**です。STL/glTF/OBJ
だけ使うなら、これら 3 つはネットワーク・メモリのいずれにも乗りません。

#### three.js ブリッジ方式について

レンダラは Babylon.js のままで、three.js は **Loader としてだけ** 同居しています:

1. `index.html` に import map を置き、`three` / `three/addons/` をベンダ
   配下に解決
2. `loaders/three-bridge.js` がファイル形式に対応する Loader モジュールを
   動的 import し、`loader.parse()` で `THREE.Object3D` 階層を取得
3. 各 `THREE.Mesh` のワールド変換を頂点位置に焼き込み、TypedArray を
   Babylon の `VertexData` に詰めて 1 つの Babylon Mesh に変換
4. 以降は他形式と同じ `modelRoot` 配下に並ぶので、カメラフレーミング・
   ワイヤーフレーム切替など既存パイプラインが透過的に効く

#### EDZ (EPLAN) の扱い

EDZ アーカイブから 3D ファイル (STEP > STP > IGES > IGS > STL の優先順)
を 1 つ自動選択して既存パイプラインに流します。複数候補がある場合は
ブラウザコンソールに全候補をログ出力し、選択された 1 つの相対パスを
ステータスに表示します。EPLAN プロジェクト本体 (`.epj` / `.elk` /
`.ema` / ...) は 2D 電気 CAE データなので本アプリの対象外です
(EPLAN Platform / 公式 eView 等を使ってください)。

#### 商用カーネル形式 (Parasolid / ACIS / SolidWorks / CATIA / Inventor)

これらは独自カーネルの SDK が NDA + 有償ライセンス必須のため OSS では
表示できません。対応するには **CAD Exchanger** や **3D InterOp** などの
商用 SDK 経由で STEP / glTF / STL に変換するパイプラインを別途用意し、
本アプリには変換後の中立フォーマットを読ませてください。

新しい形式は `web/static/loaders/<format>.js` を作って
`loaders/index.js` のレジストリに 1 行加えるだけで追加できます。サーバ側で
パースしたい場合は `core/` にパーサを足し、`web/handlers.go` の
`parseByExtension` に拡張子を追加してください。
