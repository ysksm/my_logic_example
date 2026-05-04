# chrome_dev_tool — Requirements

Chrome DevTools Protocol (CDP) 経由で Chromium をダウンロード→起動→接続し、
ログ・ネットワーク・パフォーマンスを WebUI でリアルタイムに観測する最小構成のツール。
`perf-investigator/` のシンプル版リブート。

> **方針:** Chrome DevTools 関連の高水準 Go ライブラリ (`go-rod/rod` / `chromedp/chromedp`) は
> **使用しない**。CDP は `gorilla/websocket` で直接張った WebSocket に
> 自作 JSON-RPC クライアント (`core/cdp/`) を載せて喋る。

---

## 採用する機能 (確定スコープ)

ユーザー指定により、以下 6 機能のみ。

1. Chromium ダウンロード
2. Chromium 起動
3. 接続 (attach)
4. ログ監視
5. ネットワーク監視
6. パフォーマンス監視

CDP 通信は **自作の WebSocket クライアント** で実装する。

---

## 機能要件 (Functional)

### F1. Chromium ライフサイクル
- **F1.1** Chromium バイナリの自動ダウンロード
  - まず OS 標準パス / `PATH` から既存の Chrome / Chromium / Edge を検出
  - 見つからない場合のみ、Chromium snapshot
    (`https://storage.googleapis.com/chromium-browser-snapshots/<Platform>/<rev>/`)
    を `net/http` で取得し、`archive/zip` で `~/.cache/chrome_dev_tool/chromium/<rev>/` に展開
  - revision はソース内に固定値で持ち、必要に応じて差し替え可能にする
- **F1.2** `--remote-debugging-port` 付きで `os/exec` から Chromium を起動 (headless / headful 切替)
- **F1.3** 既に起動している Chrome (`host:port`) への attach モード (DL/起動を行わない)
- **F1.4** ツール終了時、こちらが起動した Chromium プロセスのみ kill する
       (既存接続モードでは何もしない)

### F2. 接続 / ターゲット選択
- **F2.1** `http://host:port/json/version` で endpoint 確認、`/json` でタブ一覧取得
- **F2.2** `webSocketDebuggerUrl` を指定して `gorilla/websocket` で 1 本接続を張る
- **F2.3** ターゲットを 1 つ選んで `Target.attachToTarget` (flatten=true) で sessionId を取得
- **F2.4** 任意 URL へのナビゲート (起動時パラメタ + 動作中のフォーム入力 — `Page.navigate`)

### F3. ログ監視
- 有効化: `Runtime.enable` / `Log.enable`
- **F3.1** `Runtime.consoleAPICalled` (log / info / warn / error / debug)
- **F3.2** `Log.entryAdded` (browser / network / security 由来のログエントリ)
- **F3.3** `Runtime.exceptionThrown` (未捕捉例外)
- **F3.4** WebUI に time / level / source / text のリストでストリーム表示

### F4. ネットワーク監視
- 有効化: `Network.enable`
- **F4.1** `Network.requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed`
- **F4.2** status / method / type / URL / 所要 ms / size をテーブル表示
- **F4.3** ホバーで full URL、クリックで headers / mimeType の詳細表示

### F5. パフォーマンス監視
- 有効化: `Performance.enable`、ストリーム購読には `Performance.setTimeDomain` + 内部タイマで poll
       するか `Performance.metrics` イベント (Chrome 拡張機能経由) を購読
- **F5.1** `Performance.getMetrics` を一定間隔 (例: 1s) で呼び、Performance Monitor 相当として
       連続サンプリング
- **F5.2** 主要メトリクス (JSHeapUsedSize / Nodes / LayoutCount / RecalcStyleCount /
       ScriptDuration / TaskDuration / LayoutDuration 等) を
       スパークライン + 最新値で表示
- **F5.3** `Performance.getMetrics` をボタン操作で 1 回スナップショット取得

> 補足: `Performance.metrics` イベントは Chrome 内部用で公開ドメインからは
> 流れてこないため、F5.1 はサーバ側からの定期 polling で実現する。

### F6. UI / 配布
- **F6.1** 単一バイナリ `cdt` (Cobra) — `cdt serve` で WebUI を起動 (既定)
- **F6.2** React + Vite + TypeScript の SPA を `embed.FS` で Go バイナリに同梱
- **F6.3** `cdt watch` で attach のみ → stdout に NDJSON を吐く (Playwright 等から呼び出せる)
- **F6.4** `cdt list` で `/json` のタブ一覧を JSON 出力
- **F6.5** `cdt snapshot` で `Performance.getMetrics` を 1 回 JSON 出力
- **F6.6** `cdt desktop` を `//go:build wails` で予約 — 既定ビルドからは除外、将来用

---

## 非機能要件 (Non-functional)

- **N1.** Mac (darwin/amd64, darwin/arm64) / Linux (linux/amd64) / Windows (windows/amd64) で動作
- **N2.** CDP は **自作の WS+JSON-RPC クライアント** で 1 種のみ実装する
       (`go-rod/rod` `chromedp/chromedp` 等の DevTools ラッパは依存に入れない)
- **N3.** `core/` パッケージは HTTP / WebSocket(server側) / Wails のいずれにも非依存
       — `core/cdp` は CDP クライアント側 WebSocket で完結 (`gorilla/websocket`)
- **N4.** `web.NewServer(...)` は `http.Handler` を返し、Wails の
       `assetserver.Options{Handler: ...}` に直接渡せる
- **N5.** ブラウザ向け WebSocket 配信はクライアント毎リングバッファ + drop-on-overflow で
       slow consumer がほかを詰まらせないこと
- **N6.** ログ / ネットワーク / パフォーマンスは UI の checkbox で個別に enable/disable できる
       (CDP 側の `*.enable` を ON/OFF で切替)

---

## 構成 (cli / core / web の 3 レイヤ)

| パス | 役割 |
| --- | --- |
| `main.go`              | `cli.Execute()` を呼ぶだけ |
| `cli/`                 | Cobra ベースの CLI: `serve` / `watch` / `list` / `snapshot` / `desktop` (wails tag) |
| `core/browser/`        | Chrome 検出 / Chromium snapshot DL / `os/exec` 起動 / プロセス管理 |
| `core/cdp/`            | **自作 CDP クライアント** (gorilla/websocket + JSON-RPC、id/method/sessionId/params) |
| `core/collector/`      | CDP ドメイン購読 → `events.Event` 化 (network / console / performance) |
| `core/events/`         | UI / CLI / 将来の recorder が共通利用する `Event` 型 |
| `web/`                 | `http.Handler`、API ハンドラ、ブラウザ向け WS hub、`embed.FS` |
| `web/frontend/`        | React + TypeScript + Vite — `web/frontend/dist` を embed |
| `desktop/`             | 将来の Wails ラッパ用 (今は枠のみ) |

将来 Wails 対応のために守る制約:
- `web.NewServer()` は `http.Handler` を返す形を維持
- `core/` を UI 層から隔離
- `cli/desktop.go` は `//go:build wails` で囲み、既定ビルドから外す

---

## 技術スタック

- Backend (Go 1.22+):
  - `github.com/spf13/cobra` — CLI フレームワーク
  - `github.com/gorilla/websocket` — WebSocket 通信のみ (CDP クライアント側 + ブラウザ配信側で共有)
  - 標準ライブラリ: `net/http` (`/json` 取得 + Chromium snapshot DL) /
    `archive/zip` (snapshot 展開) / `os/exec` (Chromium 起動) /
    `embed` (フロントエンド埋め込み)
  - DevTools 関連の高水準 Go ライブラリ (rod / chromedp / cdproto) は **入れない**
- Frontend: React 18 + TypeScript 5 + Vite 5
- Desktop: Wails v2 (枠だけ確保。実装は別タスク)

---

## 非対応 (今回は入れない)

- Page.lifecycleEvent / Page.frameNavigated
- NDJSON ファイルへの日次ローテーション記録 (将来 `core/recorder` として後付け可能)
- Playwright 連携サンプル (`cdt watch` が NDJSON を stdout に吐けるので呼び出し側で完結)
- DevTools 関連の高水準 Go ライブラリ (rod / chromedp / cdproto) — 採用しない方針
- Chromium 任意バージョン選択 UI (固定 revision のみ)

---

## 検証 (Acceptance)

1. `make build` で `bin/cdt` ができ、`web/frontend/dist` が embed 済みであること
2. `./bin/cdt serve` で `http://localhost:7681` が開ける
3. WebUI の「Launch Chromium」で
   - 既存 Chrome が見つかればそれを起動
   - 無ければ Chromium snapshot を DL → 展開 → 起動
   - 起動後に `gorilla/websocket` で 1 本張って attach まで進む
4. `https://example.com` に navigate して Network / Console / Performance の各パネルが
   リアルタイムに更新される
5. `./bin/cdt list` がタブ一覧を JSON で出す
6. `./bin/cdt snapshot` が `Performance.getMetrics` を JSON で出す
7. `./bin/cdt watch` が stdout に NDJSON を流す
8. `go build -tags wails ./...` がエラーなく通る (Wails 枠の構文確認)
9. `go list -m all` の依存に rod / chromedp / cdproto が含まれないこと
