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

- STL ASCII / Binary

OBJ・glTF 等は `core/` に薄いパーサを足し、`web/handlers.go` の
`parseByExtension` で拡張子を分岐させれば追加できます。
