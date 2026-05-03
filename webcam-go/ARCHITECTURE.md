# アーキテクチャ

webcam-go のシステム全体の設計と、各レイヤの責務・データフローをまとめた
ドキュメントです。コードベースの詳細は各パッケージの実装を参照してください。

## 全体像

webcam-go は単一の Go バイナリで、以下の 3 形態の利用を 1 つの実行ファイル
から提供します。

1. **CLI**：`list` / `serve` のサブコマンドを持つ cobra ベースの CLI
2. **REST + MJPEG + WebSocket API**：`serve` で起動する HTTP サーバ
3. **組み込み Web UI**：Go バイナリに `go:embed` された vanilla HTML/JS の SPA

設計は **IDL ファースト**かつ **依存性逆転（Ports and Adapters）** の方針です。
- バックエンドとフロントエンドの間の契約は `idl/webcam.proto` が単一の真実
- カメラ実装は `Camera` インターフェースの裏に隠蔽（実カメラ / シミュレータの
  差し替えがビルドタグで切り替え可能）
- フロントエンドは組み込み配信のため最小構成（vanilla）。SPA を React で
  作りたい場合は pcap-go と同じ `frontend/` レイアウト（domain →
  application → infrastructure → presentation）にすればよい

```
┌──────────────────────────────────────────────────────────┐
│                  webcam-go バイナリ                       │
│                                                          │
│   main.go ─▶ cli (cobra) ─▶ core.Manager                  │
│                                ▲                         │
│                                │                         │
│                            web.Server                    │
│                  (REST + MJPEG + WebSocket)              │
│                                ▲                         │
│                       go:embed │                         │
│                       ┌────────┴────────┐                │
│                       │  vanilla SPA     │               │
│                       │  (web/static/)   │               │
│                       └─────────────────┘                │
└──────────────────────────────────────────────────────────┘
            ▲                                ▲
            │ HTTP / MJPEG / WS              │ AVFoundation / v4l2
   ┌────────┴────────┐                       │
   │   ブラウザ       │              ┌───────┴────────┐
   │  <img>/<canvas> │              │ ffmpeg (subproc)│
   └─────────────────┘              └─────────────────┘
```

## バックエンド

### パッケージ構成

| パッケージ | 役割 |
|-----------|------|
| `main`    | バイナリのエントリポイント。`cli.Execute(version)` を呼ぶだけ |
| `cli`     | cobra による CLI 定義（`list` / `serve`） |
| `core`    | ドメインロジック・モデル・`Camera` インターフェースとその実装・セッションマネージャ |
| `web`     | net/http の REST + MJPEG + WebSocket ハンドラ。SPA を `go:embed` で同梱 |
| `idl`     | `webcam.proto`：ワイヤ契約の唯一の真実 |

### core — ドメイン層

`core` がアプリケーションの中核です。`web` と `cli` はどちらも `core.Manager`
経由でカメラを操作します。

```
┌──────────────┐  StartStreamRequest  ┌──────────────┐
│  cli / web   │ ────────────────────▶│ core.Manager │
└──────────────┘                       └──────┬───────┘
                                              │ Camera.Open
                                              ▼
                                       ┌────────────────┐
                                       │   Camera       │  (interface)
                                       └────────┬───────┘
                                                │
                              ┌─────────────────┴────────────────┐
                              │                                  │
                ┌─────────────▼────────────┐         ┌──────────▼─────────┐
                │ ffmpegCamera              │         │ fakeCamera          │
                │ (camera_ffmpeg.go,        │         │ (camera_fake.go,    │
                │  build tag: ffmpeg)       │         │  デフォルト)         │
                └──────────────────────────┘         └────────────────────┘
```

**主要な型と責務**

- `Camera`（`camera.go`）：`Devices()` と `Open(ctx, opts, out chan<- Frame)`
  を提供するインターフェース。`out` チャネルに完了時の `close` を必ず行う
  契約。ビルドタグで以下の 2 実装を切り替えます。
  - `camera_ffmpeg.go`（`//go:build ffmpeg`）：システムの `ffmpeg` バイナリを
    `os/exec` で起動して MJPEG 出力を stdout から受け取る。macOS は
    AVFoundation、Linux は v4l2 を入力デバイスとして指定
  - `camera_fake.go`（デフォルト）：`image/jpeg` で合成した動くテストパターン
    を生成する。ffmpeg 不要
- `jpegScanner`（`jpeg_scanner.go`）：ffmpeg の MJPEG 出力を SOI(`0xFFD8`) /
  EOI(`0xFFD9`) で 1 フレームずつ切り出す。フレーム間の予期しないバイトに
  対しても寛容な実装
- `Manager`（`manager.go`）：セッションのライフサイクル管理
  - 各セッションに対し `sessionEntry` を持ち、リングバッファ（`frameRing`）と
    統計集計（`sessionStats`）、ライブストリーム購読者リスト（`listeners`）を
    保持
  - `run()` ゴルーチンが `Camera` の出力チャネルをドレインし、リング書き込み・
    統計更新・購読者へのファンアウトを 1 か所で行う
  - 公開 API：`Start` / `Stop` / `Sessions` / `Session` / `LatestFrame` /
    `Stats` / `Subscribe` / `Unsubscribe`
- `frameRing`（`ring.go`）：直近フレーム（FPS×2 + 8 程度）のリングバッファ。
  スナップショット取得や、購読開始時の即時 1 フレーム送出に利用
- `sessionStats`：FPS（1 秒粒度バケット）、累積バイト数、最終解像度を保持。
  `Stats()` で 60 秒ウィンドウとして整形
- `models.go`：IDL に対応する Go 構造体（`Frame`, `StreamSession`, … ）。
  `webcam.proto` の手動ミラー

**並行性モデル**

- `Manager.mu` はセッションマップ全体の RWMutex
- 各 `sessionEntry.mu` はそのセッション固有の状態を保護
- Camera → run ループ → 購読者は **シングルライタ・マルチリーダ**。購読者
  チャネルはバッファ付きで、書き込みがブロックする場合は `default` で
  **フレームをドロップ**するバックプレッシャー方針

### web — トランスポート層

`web.Server` は `core.Manager` を依存として受け取り、REST / MJPEG /
WebSocket を提供します。

- `server.go`：`net/http.Server` のラッパ。`logging` ミドルウェアでアクセス
  ログを取る
- `routes.go`：Go 1.22+ の `http.ServeMux` のメソッドルーティングで REST と
  ストリームを登録。`//go:embed all:static` でビルド済み SPA を同梱し、未知の
  パスは `index.html` にフォールバック（SPA ルーティング）
- `handlers.go`：REST ハンドラ。リクエスト/レスポンスは `core` の構造体
  （IDL ミラー）をそのまま JSON で読み書き
- `mjpeg.go`：`/api/v1/sessions/{id}/mjpeg` の `multipart/x-mixed-replace`
  ハンドラ。ブラウザの `<img>` だけで再生可能
- `stream.go`：`/api/v1/sessions/{id}/stream` の WebSocket。バイナリ JPEG を
  本体として送出し、メタ情報は JSON テキストの `StreamEnvelope` として送る。
  20 秒間隔の Ping、60 秒の Pong デッドラインあり

### REST + MJPEG + WebSocket 契約

| Method | Path                                          | リクエスト             | レスポンス                       |
|--------|-----------------------------------------------|------------------------|-----------------------------------|
| GET    | `/api/v1/devices`                             | -                      | `ListDevicesResponse`             |
| GET    | `/api/v1/sessions`                            | -                      | `ListSessionsResponse`            |
| POST   | `/api/v1/sessions`                            | `StartStreamRequest`   | `StartStreamResponse`             |
| GET    | `/api/v1/sessions/{id}`                       | -                      | `StreamSession`                   |
| DELETE | `/api/v1/sessions/{id}`                       | -                      | `StopStreamResponse`              |
| GET    | `/api/v1/sessions/{id}/stats`                 | -                      | `StatsResponse`                   |
| GET    | `/api/v1/sessions/{id}/snapshot.jpg`          | -                      | `image/jpeg` バイナリ             |
| GET    | `/api/v1/sessions/{id}/mjpeg`                 | -                      | `multipart/x-mixed-replace` ストリーム |
| GET    | `/api/v1/sessions/{id}/stream` (WS)           | -                      | `StreamEnvelope` (JSON) + binary JPEG |

### IDL の運用

`idl/webcam.proto` は **手動運用** の契約ファイルです。`protoc` は走らせず、
以下のファイルで型ミラーを保守します。

- Go：`core/models.go`

proto を変更したら必ず Go ミラーも揃えて更新します。フロントエンドを React 化
する場合は `frontend/src/domain/idl.ts` を追加し、こちらも同期対象にします。

## フロントエンド（組み込み SPA）

`web/static/index.html` は依存ゼロの単一ファイル SPA です。
`/api/v1/devices` でデバイス一覧を取得し、フォームの値で `POST
/api/v1/sessions` してから、選択したトランスポート（MJPEG または WebSocket）
で映像を表示します。`/api/v1/sessions/{id}/stats` を 1 秒ごとにポーリングして
フレーム数 / FPS / 転送量を更新します。

将来 React へ移行したい場合は、pcap-go と同じレイヤード構成
（`domain` / `application` / `infrastructure` / `presentation`）を `frontend/`
配下に作り、`web/routes.go` の `go:embed` ターゲットを `frontend/dist` に
切り替えるだけで配信経路は変わりません。

## ランタイム動作

### CLI: `webcam-go list`

1. `cli.Execute(version)` が `core.NewManager(core.NewCamera())` を生成
2. `listCmd` が `Manager.Devices()` を呼び、stdout に表形式で出力

### Web: `webcam-go serve`

1. `serveCmd` が `web.NewServer(manager)` を作り、`ListenAndServe` で待ち受け
2. ブラウザは SPA を取得し、`/api/v1/devices` を呼ぶ
3. 「開始」で `POST /api/v1/sessions` → `Manager.Start`
4. SPA は MJPEG なら `<img src="/api/v1/sessions/{id}/mjpeg">` を、
   WebSocket なら `/api/v1/sessions/{id}/stream` を開いてフレームを受信
5. 並行して `/api/v1/sessions/{id}/stats` をポーリングして表示を更新

### ライブストリームのフレームフロー

```
カメラ ─▶ ffmpeg (subprocess, MJPEG) ─▶ jpegScanner.Next ─▶ Frame
                                                 │
                                                 ▼
                                       Manager.run goroutine
                                       ├─ session.FrameCount++
                                       ├─ ring.push(f)
                                       ├─ stats.record(f)
                                       └─ for ch in listeners:
                                            select { ch <- f; default: drop }
                                                 │
                                ┌────────────────┴────────────────┐
                                ▼                                 ▼
                       mjpeg.go (HTTP)                    stream.go (WS)
                       multipart/x-mixed-replace          binary JPEG + JSON
                                │                                 │
                                ▼                                 ▼
                       <img src="...">                  WebSocket onmessage
```

## ビルドと配布

- `make build`（デフォルト）：シミュレータ。Go バイナリのみ、外部依存なし
- `make build-ffmpeg`：`-tags ffmpeg` でリアルキャプチャ版（実行時に `ffmpeg`
  が必要）
- SPA は `web/static/` に直接置かれており、`go:embed` で Go バイナリに同梱。
  本番では SPA とサーバが同一オリジンで配信されます

## 拡張ポイント

- **別のキャプチャソース**：`Camera` インターフェースを実装した型を作り、
  `NewCamera()` を差し替えるだけで `Manager` 以降は変更不要（ビデオファイル
  からの再生、GStreamer / V4L2 を直接叩く実装、ネット越しの中継、など）
- **新しいエンコード**：`Frame.Mime` を `image/webp` などに広げ、`Camera`
  実装側でエンコードを選べるようにする
- **新しい配信プロトコル**：`web/` に WHEP/WebRTC や HLS のハンドラを追加。
  `Manager.Subscribe` で受け取ったフレームをパケタイズすれば良い
- **React 化**：`frontend/` を pcap-go と同じレイヤード構成で立て、
  `web/routes.go` の埋め込み先を `frontend/dist` に切り替える
