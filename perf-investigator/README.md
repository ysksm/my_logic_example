# perf-investigator

Chrome の **--remote-debugging-port** に接続し、Network / Console / Performance / Performance Monitor の各 CDP ドメインを継続的に観測するためのツール群。

3 種類の Go バックエンド (`chromedp` / `rod` / 自作 WS クライアント) と 3 種類の UI (CLI / WebUI / Wails デスクトップ) を同じ `Collector` インターフェースの上に揃え、Playwright と組み合わせて E2E テストの裏で常時ロギングする使い方も想定している。

## いちばん簡単な使い方 (Mac / Linux / Windows)

```bash
git clone <repo>
cd perf-investigator
make all-bin                              # web をビルドして同梱した1バイナリを生成
./bin/pi-all -url https://example.com
```

これだけで:

1. ローカルの Chrome (Mac は `/Applications/Google Chrome.app` を自動検出) を `--remote-debugging-port` 付きで起動
2. WebUI (`http://localhost:7681`) を立てて自動的に既定ブラウザで開く
3. rod ベースの Collector が attach してイベントを `./recordings/pi-YYYY-MM-DD.ndjson` に書きながら WebUI に流す

オプション:

| フラグ | 既定値 | 役割 |
| --- | --- | --- |
| `-url`     | `https://example.com` | 起動した Chrome で開く URL |
| `-headless` | `false`              | ヘッドレスで Chrome を立てる |
| `-chrome`  | (空)                  | Chrome バイナリのパスを明示指定 |
| `-addr`    | `:7681`               | WebUI のリッスンアドレス |
| `-no-open` | `false`               | 既定ブラウザを自動で開かない |
| `-record`  | `./recordings`        | NDJSON 出力ディレクトリ (空文字で無効) |
| `-source`  | `rod`                 | バックエンド: `rod` / `chromedp` / `raw` |

> Chrome が入っていない環境では rod の launcher が初回に Chromium を自動ダウンロードするので、最初の起動だけ少し時間がかかる。

```
                                ┌──────────────┐
       Chrome (port 9222) ─────►│   pkg/cdp    │  自作 WS クライアント
                          ┌────►│   pkg/collectors/raw       (rawソース)
                          │     │   pkg/collectors/chromedp  (chromedpソース)
                          ├────►│   pkg/collectors/rod       (rodソース)
                          │     └──────┬───────┘
                          │            │ events.Event
                          │     ┌──────▼──────────┐
                          │     │ pkg/server.Hub  │── Sink (NDJSON recorder)
                          │     └──┬───────────┬──┘
                          │  WS    │  HTTP API │
                          │  /ws   │  /api/*   │
                          ▼        ▼           ▼
                       CLI     React UI      Wails desktop
```

## 構成要素

| パス | 役割 |
| --- | --- |
| `pkg/cdp/`             | 依存最小の自作 CDP クライアント (gorilla/websocket + JSON) |
| `pkg/events/`          | UI/レコーダ/CLI が共通に使う `Event` モデル |
| `pkg/collectors/`      | 3 つの実装 (`raw.go` / `chromedp.go` / `rod.go`) |
| `pkg/recorder/`        | NDJSON で日次ローテーションする継続ログ Sink |
| `pkg/server/`          | HTTP API + WebSocket fan-out (`Hub`) |
| `cmd/cli/`             | `pi-cli` バイナリ (list / watch / snapshot) |
| `cmd/server/`          | `pi-server` (WebUI 用 HTTP+WS サーバ) |
| `cmd/wails/`           | Wails v2 デスクトップアプリ (build tag `wails`) |
| `web/`                 | React フロントエンド (Vite + TypeScript) — WebUI と Wails 共通 |
| `playwright/`          | Playwright と組み合わせた E2E ロギング例 |
| `scripts/launch-chrome.sh` | デバッグ Chrome 起動ヘルパー |

## ビルド & 実行

```bash
# Go バイナリ
make all                                  # bin/pi-cli, bin/pi-server, web/dist
# 個別に
go build -o bin/pi-cli ./cmd/cli
go build -o bin/pi-server ./cmd/server
( cd web && npm install && npm run build )
```

### 1. Chrome をデバッグポート付きで起動

```bash
./scripts/launch-chrome.sh https://example.com 9222
# あるいは
chrome --remote-debugging-port=9222 --user-data-dir=$(mktemp -d) https://example.com
```

### 2. CLI で観測

```bash
# 開いているタブ一覧
./bin/pi-cli list

# 全部入りで監視 (raw 実装、stdout & ./recordings に NDJSON)
./bin/pi-cli watch -source raw -record ./recordings

# chromedp 実装で URL を開きながら監視
./bin/pi-cli watch -source chromedp -url https://example.com

# rod 実装で監視
./bin/pi-cli watch -source rod

# その時点の Performance.getMetrics を 1 回スナップショット
./bin/pi-cli snapshot -source raw
```

`-no-network` / `-no-console` / `-no-perf` / `-no-monitor` で個別ドメインを抑制できる。`-json` を付けると整形ログでなく NDJSON が stdout に流れる。

### 3. WebUI

```bash
./bin/pi-server -addr :7681 -ui ./web/dist -record ./recordings
# ブラウザで http://localhost:7681 を開く
```

開発時は同時に Vite を立ち上げてプロキシ経由でつなぐ:

```bash
( cd web && npm run dev )       # http://localhost:5173 (api/ws を :7681 にプロキシ)
./bin/pi-server                 # 別ターミナル
```

UI で backend (raw / chromedp / rod) と有効化するドメイン (Network / Console / Performance / Perf Monitor / Lifecycle) を切り替え、Start すると `/ws` 経由で Event がストリーミングされる。Network テーブル、Console / Log、Performance Monitor のスパークラインをリアルタイム表示。

### 4. Wails デスクトップ

同じ React UI と同じ Go コアをデスクトップアプリとして同梱する。

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
cd cmd/wails
wails build              # 配布用バイナリ
wails dev                # ホットリロード開発
```

`cmd/wails/wails.json` の `frontend:build` が `web/` をビルドして `cmd/wails/frontend/dist` にコピーする (embed 用)。`go build ./...` で衝突しないよう wails 側のソースには `//go:build wails` を付けてある。

### 5. Playwright と連携した継続ロギング

Playwright が Chromium を `--remote-debugging-port` 付きで起動 → `pi-cli watch` がそこに attach → シナリオの間ずっとイベントを `./recordings/pi-YYYY-MM-DD.ndjson` に書き続ける。

```bash
cd playwright
npm install
npx playwright install chromium
PI_CLI=$(pwd)/../bin/pi-cli npx playwright test perf.spec.ts
# あるいは単純に手動シナリオ:
PI_CLI=$(pwd)/../bin/pi-cli node launch-and-watch.mjs https://example.com
```

`perf.spec.ts` は Playwright のアサーションを書きながら、その裏で Go 側が CDP 観点の指標を独立に記録する例。CI に組み込んで NDJSON をアーティファクトとして保存すると、回帰の有無を後追いできる。

## 共通 Event モデル

`pkg/events/types.go` で定義。`web/src/types.ts` がフロントの対応型。

| Kind | 出どころ (CDP) |
| --- | --- |
| `network.request`  | `Network.requestWillBeSent` |
| `network.response` | `Network.responseReceived` |
| `network.finished` | `Network.loadingFinished` |
| `network.failed`   | `Network.loadingFailed` |
| `console`          | `Runtime.consoleAPICalled` |
| `log`              | `Log.entryAdded` |
| `exception`        | `Runtime.exceptionThrown` |
| `perf.monitor`     | `Performance.metrics` (ストリーム) |
| `perf.metrics`     | `Performance.getMetrics` (オンデマンド) |
| `page.lifecycle`   | `Page.lifecycleEvent` |
| `page.navigated`   | `Page.frameNavigated` |
| `meta`             | 内部メタ (アタッチ通知など) |

`Event.Source` フィールドでどの Collector (`raw`/`chromedp`/`rod`) が吐いたかを判別できる。

## なぜ 3 実装を持つか

- **raw** は WebSocket と JSON だけで CDP を喋る最小実装。各メソッドの挙動を 1:1 で確認したいときの参照系。
- **chromedp** は `cdproto` の型付けがある分 Chrome 側のスキーマ追従が容易。タスクをパイプラインで書きたい操作向き。
- **rod** はリトライや待機が組み込まれていて、ページ操作と組み合わせる長尺シナリオに向く。

同じ `Sink` に流すので、UI 側はバックエンドが何であっても透過的に扱える。

## テスト

```bash
go test ./...
```

`pkg/cdp` には WS をモックした往復テスト、`pkg/recorder` には NDJSON ローテーションのテストが入っている。
