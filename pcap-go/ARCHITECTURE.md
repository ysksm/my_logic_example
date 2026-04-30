# アーキテクチャ

pcap-go のシステム全体の設計と、各レイヤの責務・データフローをまとめたドキュメントです。
コードベースの詳細は各パッケージの実装を参照してください。

## 全体像

pcap-go は単一の Go バイナリで、以下の 3 形態の利用を 1 つの実行ファイルから提供します。

1. **CLI**：`list` / `capture` / `serve` のサブコマンドを持つ cobra ベースの CLI
2. **REST + WebSocket API**：`serve` で起動する HTTP サーバ
3. **組み込み Web UI**：Go バイナリに `go:embed` された React + Vite 製の SPA

設計は **IDL ファースト**かつ **依存性逆転（Ports and Adapters）** の方針です。
- バックエンドとフロントエンドの間の契約は `idl/pcap.proto` が単一の真実
- バックエンドのキャプチャ実装は `Capturer` インターフェースの裏に隠蔽（実キャプチャ /
  シミュレータの差し替えがビルドタグで切り替え可能）
- フロントエンドは「ドメイン → アプリケーション → インフラ / プレゼンテーション」の
  レイヤード構成で、内側は外側に依存しない

```
┌──────────────────────────────────────────────────────────┐
│                     pcap-go バイナリ                      │
│                                                          │
│   main.go ─▶ cli (cobra) ─▶ core.Manager                  │
│                                ▲                         │
│                                │                         │
│                            web.Server                    │
│                       (REST + WebSocket)                 │
│                                ▲                         │
│                       go:embed │                         │
│                       ┌────────┴────────┐                │
│                       │  React SPA       │               │
│                       │  (frontend/dist) │               │
│                       └─────────────────┘                │
└──────────────────────────────────────────────────────────┘
            ▲                                ▲
            │ 接続（HTTP / WS）              │ /sudo BPF
   ┌────────┴────────┐                       │
   │   ブラウザ      │              ┌────────┴────────┐
   │ React SPA       │              │  libpcap (NIC)   │
   └─────────────────┘              └─────────────────┘
```

## バックエンド

### パッケージ構成

| パッケージ | 役割 |
|-----------|------|
| `main`    | バイナリのエントリポイント。`cli.Execute(version)` を呼ぶだけ |
| `cli`     | cobra による CLI 定義（`list` / `capture` / `serve`） |
| `core`    | ドメインロジック・モデル・`Capturer` インターフェースとその実装・セッションマネージャ |
| `web`     | net/http の REST + WebSocket ハンドラ。SPA の静的ファイルを `go:embed` で同梱 |
| `idl`     | `pcap.proto`：ワイヤ契約の唯一の真実 |

### core — ドメイン層

`core` がアプリケーションの中核です。`web` と `cli` はどちらも `core.Manager` 経由で
キャプチャを操作します。

```
┌──────────────┐  StartCaptureRequest  ┌──────────────┐
│  cli / web   │ ─────────────────────▶│ core.Manager │
└──────────────┘                       └──────┬───────┘
                                              │ Capturer.Capture
                                              ▼
                                       ┌────────────────┐
                                       │   Capturer     │  (interface)
                                       └────────┬───────┘
                                                │
                              ┌─────────────────┴────────────────┐
                              │                                  │
                ┌─────────────▼────────────┐         ┌──────────▼─────────┐
                │ pcapCapturer              │         │ fakeCapturer        │
                │ (capture_pcap.go,         │         │ (capture_fake.go,   │
                │  build tag: pcap)         │         │  デフォルト)         │
                └──────────────────────────┘         └────────────────────┘
```

**主要な型と責務**

- `Capturer`（`capturer.go`）：`Interfaces()` と `Capture(ctx, opts, out chan<- Packet)`
  を提供するインターフェース。`out` チャネルに完了時の `close` を必ず行う
  契約。ビルドタグで以下の 2 実装を切り替えます。
  - `capture_pcap.go`（`//go:build pcap`）：libpcap + gopacket による実キャプチャ。
    Ethernet → IPv4/v6 → TCP/UDP/ICMP → DNS/HTTP/TLS をデコードして `Packet` に詰める
  - `capture_fake.go`（デフォルト）：開発用のインメモリシミュレータ。libpcap 不要
- `Manager`（`manager.go`）：キャプチャセッションのライフサイクル管理。
  - 各セッションに対し `sessionEntry` を持ち、リングバッファ（`packetRing`）と統計集計
    （`sessionStats`）、そしてライブストリーム購読者リスト（`listeners`）を保持
  - `run()` ゴルーチンが `Capturer` の出力チャネルをドレインし、リング書き込み・統計
    更新・購読者へのファンアウトを 1 か所で行う
  - 公開 API：`Start` / `Stop` / `Sessions` / `Session` / `Packets` / `Peers` /
    `Stats` / `Subscribe` / `Unsubscribe`
- `packetRing`（`ring.go`）：固定容量（2048）のリングバッファ。`since(afterSeq, limit)`
  で「ある seq 以降のパケット」を取得できるため、SPA 起動時のリプレイに利用
- `sessionStats`：トランスポート / アプリケーションごとのプロトコル分布、IP / MAC
  ピア集計、1 秒粒度のレートバケットを保持。`Stats(topN)` で 60 秒ウィンドウとして整形
- `oui.go` + `oui_data.go`：MAC アドレスの先頭 OUI を組み込みテーブルから引いてベンダー
  名を返す
- `ipranges.go` + `ipranges_data.go`：CIDR → クラウド / サービス所有者の解決テーブル。
  埋め込みのキュレーション値 + ユーザディレクトリ（`~/.pcap-go/ipranges.json`、または
  `PCAP_GO_IPRANGES` 環境変数）の上書きをマージ。`UpdateIPRanges()` で AWS / GCP /
  Cloudflare / GitHub / Fastly の公式フィードを取得して書き出す
- `revdns.go`：オンデマンドの逆引き DNS（`net.LookupAddr` + 3 秒タイムアウト + 5 分の
  プロセス内キャッシュ）
- `appdecode.go`：HTTP / TLS の最低限のデコード（リクエスト行・SNI 取得など）
- `models.go`：IDL に対応する Go 構造体（`Packet`, `Layers`, `CaptureSession`, … ）。
  `pcap.proto` の手動ミラー

**並行性モデル**

- `Manager.mu` はセッションマップ全体の RWMutex
- 各 `sessionEntry.mu` はそのセッション固有の状態を保護
- Capturer → run ループ → 購読者は **シングルライタ・マルチリーダ**。購読者チャネルは
  バッファ付きで、書き込みがブロックする場合は `default` で**パケットをドロップ**する
  バックプレッシャー方針

### web — トランスポート層

`web.Server` は `core.Manager` を依存として受け取り、REST と WebSocket を提供します。

- `server.go`：`net/http.Server` のラッパ。`logging` ミドルウェアでアクセスログを取る
- `routes.go`：Go 1.22+ の `http.ServeMux` のメソッドルーティング機能で REST と WS を登録。
  `//go:embed all:static` でビルド済み SPA を同梱し、未知のパスは `index.html` に
  フォールバック（SPA ルーティング）
- `handlers.go`：REST ハンドラ。リクエスト/レスポンスは `core` の構造体（IDL ミラー）
  をそのまま JSON で読み書き
- `stream.go`：`/api/v1/sessions/{id}/stream` の WebSocket。`gorilla/websocket` で
  Upgrade し、`Manager.Subscribe` で受け取ったパケットを `StreamEnvelope` として
  送出。20 秒間隔の Ping、60 秒の Pong デッドライン、定期的なセッションスナップショット
  送信を行う

### REST + WebSocket 契約

| Method | Path                                  | リクエスト                  | レスポンス                |
|--------|---------------------------------------|-----------------------------|---------------------------|
| GET    | `/api/v1/interfaces`                  | -                           | `ListInterfacesResponse`  |
| GET    | `/api/v1/sessions`                    | -                           | `ListSessionsResponse`    |
| POST   | `/api/v1/sessions`                    | `StartCaptureRequest`       | `StartCaptureResponse`    |
| DELETE | `/api/v1/sessions/{id}`               | -                           | `StopCaptureResponse`     |
| GET    | `/api/v1/sessions/{id}/packets`       | クエリ：`after_seq`, `limit` | `ListPacketsResponse`     |
| GET    | `/api/v1/sessions/{id}/peers`         | クエリ：`kind`              | `ListPeersResponse`       |
| GET    | `/api/v1/sessions/{id}/stats`         | クエリ：`top`               | `StatsResponse`           |
| GET    | `/api/v1/oui/{mac}`                   | -                           | `OUIResponse`             |
| GET    | `/api/v1/ipranges/status`             | -                           | `IPRangesStatus`          |
| POST   | `/api/v1/ipranges/update`             | -                           | `IPRangesUpdateResponse`  |
| GET    | `/api/v1/dns/reverse/{ip}`            | -                           | `ReverseDNSResponse`      |
| GET    | `/api/v1/sessions/{id}/stream` (WS)   | -                           | `StreamEnvelope` のストリーム |

### IDL の運用

`idl/pcap.proto` は **手動運用** の契約ファイルです。`protoc` は走らせず、以下の 2 ファイル
で型ミラーを保守します。

- Go：`core/models.go`
- TypeScript：`frontend/src/domain/idl.ts`

ワイヤ表現は JSON（snake_case、protojson デフォルト）。proto を変更したら必ず両方の
ミラーを揃えて更新します。

## フロントエンド

`frontend/` は React + Vite + TypeScript 製の SPA で、クリーンアーキテクチャ準拠の
レイヤード構成を取っています。

```
┌──────────────────────────────────────────┐
│              presentation                │  React コンポーネント、ページ、フック
│   (App.tsx, components/, pages/, hooks/) │
└────────────────────┬─────────────────────┘
                     │ uses
┌────────────────────▼─────────────────────┐
│              application                 │  ユースケース／サービス（純粋ロジック）
│        (captureService, ports)           │
└────────────────────┬─────────────────────┘
                     │ depends on (port)
┌────────────────────▼─────────────────────┐
│              infrastructure              │  ポートの実装（HTTP / WS アダプタ）
│  (httpCaptureGateway, wsPacketStream)    │
└────────────────────┬─────────────────────┘
                     │
┌────────────────────▼─────────────────────┐
│                 domain                   │  IDL 型・ドメインモデル（純粋データ）
│              (idl, types)                │
└──────────────────────────────────────────┘
```

### 各レイヤの責務

- **domain/**：`pcap.proto` の TS ミラー（`idl.ts`）と、フォーム値などの UI 中立な
  ドメイン型（`types.ts`）。React や fetch を一切知らない
- **application/**：
  - `ports.ts`：`CaptureGateway` と `PacketStream` のインターフェース。
    アプリケーション層が「外界に何を依頼したいか」を表す
  - `captureService.ts`：`CaptureGateway` を介してユースケースを実装する純粋ロジック。
    入力バリデーション（例：interface 必須）もここで完結する
- **infrastructure/**：ポートの具体実装。
  - `httpCaptureGateway.ts`：REST 呼び出し
  - `wsPacketStream.ts`：WebSocket でのライブストリーム購読
  - `container.ts`：コンポジションルート。`HttpCaptureGateway` と `WsPacketStream`
    をインスタンス化し、`CaptureService` に注入する
- **presentation/**：React コンポーネント、ページ、フック。`container.ts` から
  `captureService` / `packetStream` を取り出して利用する

### 依存方向

依存は内側にしか向きません。

```
presentation ─▶ application ─▶ domain
infrastructure ─▶ application（ポート定義）／ domain
```

`presentation` と `infrastructure` は同じ「外側」のレイヤであり、互いを直接参照しない。
両者は `application` と `domain` の語彙だけで会話します。これにより、
- 通信プロトコルを差し替えても application 層は変わらない
- application 層のユースケースはコンポーネント抜きで単体テストしやすい
という性質が保たれます。

## ランタイム動作

### CLI: `pcap-go capture`

1. `cli.Execute(version)` が `core.NewManager(core.NewCapturer())` を生成
2. `captureCmd` が `Manager.Start` を呼び、出力ストリームを購読
3. `Capturer` がパケットを生成 → `Manager.run` がリング/統計/購読者へ反映
4. 購読チャネルから受け取った各パケットを stdout に書き出す

### Web: `pcap-go serve`

1. `serveCmd` が `web.NewServer(manager)` を作り、`ListenAndServe` で待ち受け
2. ブラウザは SPA を取得し、REST で `interfaces` / `sessions` を取得
3. 「Start capture」で `POST /api/v1/sessions` → `Manager.Start`
4. SPA は WebSocket `/api/v1/sessions/{id}/stream` を開いてライブパケットを購読
5. 並行して `/packets`（リプレイ）、`/peers`、`/stats` をポーリング／オンデマンド取得

### ライブストリームのパケットフロー

```
NIC ─▶ libpcap ─▶ pcapCapturer.Capture
                       │ Packet
                       ▼
                Manager.run goroutine
                ├─ session.PacketCount++
                ├─ ring.push(p)
                ├─ stats.record(p)   (proto / peer / rate)
                └─ for ch in listeners: select { ch <- p; default: drop }
                       │
                       ▼
                stream.go (WS handler)
                       │ JSON encode
                       ▼
                StreamEnvelope ─▶ ブラウザ
```

## ビルドと配布

- `make all`（デフォルト）：フロントエンドをビルドして `web/static/` に出力 →
  Go バイナリをビルド（シミュレータ）
- `make build-pcap`：`-tags pcap` を付けて libpcap 連携版をビルド
- `frontend` のビルド成果物は `web/static/` にコピーされ、`go:embed` で Go バイナリ
  に同梱されます。本番では SPA とサーバが同一オリジンで配信されます

## 拡張ポイント

- **新しいレイヤのデコード**：`core/capture_pcap.go` の `decodePacket` に分岐を追加し、
  対応するレイヤを `core/models.go` と `idl/pcap.proto` に定義、TS 側 `idl.ts` も
  更新
- **別のキャプチャソース**：`Capturer` インターフェースを実装した型を作り、
  `NewCapturer()` を差し替えるだけで `Manager` 以降は変更不要（pcap ファイルから
  読むモードなど）
- **新しい REST エンドポイント**：`Manager` にメソッドを足し、`web/handlers.go` /
  `web/routes.go` にハンドラを追加、IDL とミラーを更新
- **フロントエンドのトランスポート差し替え**：`CaptureGateway` / `PacketStream` ポート
  の別実装（例：gRPC-Web）を `infrastructure/` に作り、`container.ts` で差し替える。
  application 以上は変更不要
