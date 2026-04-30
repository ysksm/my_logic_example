# pcap-go

macOS 向けのパケットキャプチャツールキット（Linux でも動作します）。
単一の Go バイナリとして配布され、CLI と組み込みの Web UI の両方を提供します。

## 機能

- キャプチャ可能なネットワークインターフェース一覧の表示
- BPF フィルター・snaplen・プロミスキャスモードを指定したライブキャプチャ
- CLI（`list` / `capture` / `serve`）と組み込みの React SPA
- WebSocket によるデコード済みパケットのライブストリーム
- IDL ファースト設計：`idl/pcap.proto` がバックエンドとフロントエンドの唯一の契約
- レイヤごとのデコード詳細（Ethernet, IPv4/IPv6, TCP, UDP, ICMP, DNS, HTTP, TLS）と
  Wireshark 風のディテールペイン
- 組み込み OUI テーブルによる MAC → ベンダー解決（Apple, Intel, Cisco, Samsung,
  Espressif, Raspberry Pi など）
- ピア一覧（IP / MAC ピア、ベンダー、パケット数 / バイト数 / 送信 / 受信、初回・最終
  観測時刻）
- 可視化：トランスポート / アプリケーションプロトコルの分布、トップピア、直近 60 秒の
  パケットレートのスパークライン
- フィルターバー：フリーテキスト（ホスト・ベンダー・SNI・サマリー）、アドレス、ポート、
  プロトコル絞り込み（TCP / UDP / ICMPv4 / DNS / TLS / HTTP）

## リポジトリ構成

```
pcap-go/
├── idl/              # .proto IDL — REST + WebSocket の契約
├── core/             # ドメインロジック、キャプチャエンジン、セッションマネージャ
├── cli/              # cobra ベースの CLI（list / capture / serve）
├── web/              # net/http REST + WebSocket サーバ。go:embed で SPA を埋め込む
├── frontend/         # React + Vite SPA（TypeScript・レイヤード設計）
│   └── src/
│       ├── domain/         # IDL 型 + ドメインルール
│       ├── application/    # ユースケース（ポート + サービス）
│       ├── infrastructure/ # REST/WebSocket アダプタ（ポート実装）
│       └── presentation/   # React コンポーネント、ページ、フック
├── main.go           # バイナリのエントリポイント
├── go.mod
└── Makefile
```

フロントエンドは クリーンアーキテクチャの考え方に沿ったレイヤード設計です。
内側のレイヤ（domain / application）は React や fetch を一切知らず、外側のレイヤ
（infrastructure / presentation）が application 層のポートを実装します。

詳細な設計指針は [`ARCHITECTURE.md`](./ARCHITECTURE.md) を参照してください。

## ビルド

### デフォルト（シミュレータ）

デフォルトビルドはインメモリのパケットシミュレータを使用するため、システム
ライブラリは不要です。libpcap が無い開発環境での動作確認に便利です。

```sh
make all              # フロントエンド + Go バイナリをビルド
./bin/pcap-go serve   # http://localhost:8080
```

### 実キャプチャ（macOS / Linux）

実キャプチャは `pcap` ビルドタグの裏側にあり、libpcap のヘッダが必要です。
macOS は SDK に libpcap が同梱されているため、通常は追加のインストールは不要です。

```sh
make frontend
make build-pcap
sudo ./bin/pcap-go list
sudo ./bin/pcap-go capture -i en0 -f "tcp port 443" -c 10
sudo ./bin/pcap-go serve --addr :8080
```

macOS で BPF デバイスを開くには `sudo`（または BPF デバイスの権限）が必要です。

## 開発

Go API と Vite 開発サーバを並行して起動します。

```sh
# ターミナル 1 — Go API（:8080）
go run . serve --addr :8080

# ターミナル 2 — Vite 開発サーバ（:5173、/api → :8080 へプロキシ）
cd frontend && npm run dev
```

ブラウザで <http://localhost:5173> を開きます。

## REST エンドポイント

詳細な契約は `idl/README.md` を参照してください。クイックリファレンスは以下です。

| Method | Path                                  |
|--------|---------------------------------------|
| GET    | `/api/v1/interfaces`                  |
| GET    | `/api/v1/sessions`                    |
| POST   | `/api/v1/sessions`                    |
| DELETE | `/api/v1/sessions/{id}`               |
| GET    | `/api/v1/sessions/{id}/packets`       |
| GET    | `/api/v1/sessions/{id}/peers`         |
| GET    | `/api/v1/sessions/{id}/stats`         |
| GET    | `/api/v1/sessions/{id}/stream` (WS)   |
| GET    | `/api/v1/oui/{mac}`                   |

## IDL

`idl/pcap.proto` が契約の単一の真実です。ワイヤ上のフィールド名は snake_case
（protojson のデフォルトに従う）です。Go と TypeScript の型定義は手動でミラーを
維持しています。

- Go: `core/models.go`
- TypeScript: `frontend/src/domain/idl.ts`

proto を変更する際は、両方のミラーを必ず同時に更新してください。
