# webcam-go

WEB カメラを WEB ブラウザで配信する単一バイナリの Go サーバーです。
mac の AVFoundation（または Linux の v4l2）から取り込んだ映像を、
**MJPEG (`multipart/x-mixed-replace`)** および **WebSocket（バイナリ JPEG）**
として配信します。組み込みの SPA 付きで、`make build && ./bin/webcam-go serve`
で `http://localhost:8080` にアクセスすればすぐに視聴できます。

> アーキテクチャの詳細は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。

## 特徴

- 単一バイナリ：CLI（`list` / `serve`）と Web UI を 1 つの実行ファイルから提供
- ハードウェア依存ゼロのデフォルトビルド：合成カメラ（テストパターン）で動作確認可能
- 実カメラビルド：`-tags ffmpeg` でシステムの `ffmpeg` バイナリ経由で
  - macOS: AVFoundation（内蔵 / USB / 仮想カメラ）
  - Linux: v4l2 (`/dev/video*`)
- 配信方式は 2 系統：
  - **MJPEG**：`<img src="/api/v1/sessions/{id}/mjpeg">` だけで再生可能
  - **WebSocket**：バイナリ JPEG 配信（必要に応じて Canvas 描画やフィルタリングに）
- スナップショット：`GET /api/v1/sessions/{id}/snapshot.jpg`

## 使い方

### 1. シミュレータで試す（依存ゼロ）

```bash
make build
./bin/webcam-go list
./bin/webcam-go serve --addr :8080
# ブラウザで http://localhost:8080 を開く
```

合成カメラ `fake-0`（グラデーション）と `fake-1`（ストライプ）が使えます。

### 2. 実カメラで配信する（macOS / Linux）

`ffmpeg` が PATH に入っている必要があります（macOS は `brew install ffmpeg`）。

```bash
make build-ffmpeg
./bin/webcam-go list                 # 利用可能なデバイスを列挙
./bin/webcam-go serve --addr :8080   # サーバ起動
```

macOS で内蔵カメラを使う場合、初回起動時にカメラアクセス許可ダイアログが
出ます（ターミナル / iTerm2 等の親プロセスに対して）。許可後、再度起動
してください。

## API

| Method | Path                                          | 用途                              |
|--------|-----------------------------------------------|-----------------------------------|
| GET    | `/api/v1/devices`                             | 利用可能なカメラ一覧              |
| GET    | `/api/v1/sessions`                            | アクティブセッション一覧          |
| POST   | `/api/v1/sessions`                            | ストリーム開始                    |
| GET    | `/api/v1/sessions/{id}`                       | セッション詳細                    |
| DELETE | `/api/v1/sessions/{id}`                       | セッション停止                    |
| GET    | `/api/v1/sessions/{id}/stats`                 | フレーム数 / FPS / 転送量         |
| GET    | `/api/v1/sessions/{id}/snapshot.jpg`          | 最新フレームを 1 枚 JPEG で返却   |
| GET    | `/api/v1/sessions/{id}/mjpeg`                 | MJPEG 配信                        |
| GET    | `/api/v1/sessions/{id}/stream` (WS)           | WebSocket バイナリ配信            |
| GET    | `/healthz`                                    | ヘルスチェック                    |

リクエスト例：

```bash
# ストリーム開始
curl -X POST http://localhost:8080/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"fake-0","width":640,"height":480,"framerate":15,"quality":75}'
# => {"session":{"id":"abc...","state":"running",...}}

# MJPEG をブラウザで開く
open "http://localhost:8080/api/v1/sessions/abc.../mjpeg"

# スナップショット保存
curl -o snap.jpg "http://localhost:8080/api/v1/sessions/abc.../snapshot.jpg"
```

## ビルドターゲット

| target            | 説明                                                |
|-------------------|-----------------------------------------------------|
| `make build`      | デフォルト（シミュレータ）                           |
| `make build-ffmpeg` | `-tags ffmpeg` でリアルキャプチャ版                |
| `make run`        | ビルドして `serve` を起動                            |
| `make dev`        | `go run . serve` で直接起動                          |
| `make test`       | `go test ./...`                                      |

## ディレクトリ構成

```
webcam-go/
├── main.go              # cli.Execute(version)
├── cli/                 # cobra: root / list / serve
├── core/                # ドメイン層：Camera インターフェース、Manager、Frame ring、stats
│   ├── camera.go        # Camera インターフェース定義
│   ├── camera_fake.go   # デフォルト：合成カメラ
│   ├── camera_ffmpeg.go # -tags ffmpeg：AVFoundation / v4l2
│   ├── jpeg_scanner.go  # MJPEG ストリームから 1 フレームずつ切り出す
│   ├── manager.go       # セッションのライフサイクル / 購読
│   ├── ring.go          # 直近フレームのリングバッファ
│   └── models.go        # IDL ミラー（snake_case JSON）
├── web/                 # トランスポート層：REST + MJPEG + WebSocket
│   ├── server.go
│   ├── routes.go        # ルーティング + go:embed の SPA 配信
│   ├── handlers.go      # REST ハンドラ
│   ├── mjpeg.go         # multipart/x-mixed-replace ハンドラ
│   ├── stream.go        # WebSocket ハンドラ
│   └── static/          # 組み込み SPA（vanilla HTML/JS）
├── idl/
│   ├── webcam.proto     # ワイヤ契約の唯一の真実
│   └── README.md
├── Makefile
└── README.md
```
