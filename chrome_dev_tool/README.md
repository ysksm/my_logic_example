# chrome_dev_tool

Chromium をダウンロード→起動→接続して、ログ・ネットワーク・パフォーマンスを WebUI で観測するツール。
`perf-investigator` のシンプル版リブート。

CDP は **`gorilla/websocket` + 自作 JSON-RPC** で直接喋る。
`go-rod/rod` / `chromedp/chromedp` / `chromedp/cdproto` は依存に入れない。

## 構成

```
chrome_dev_tool/
├── main.go
├── cli/                 # cobra: serve / watch / list / snapshot / desktop(wails tag)
├── core/
│   ├── browser/         # Chrome 検出 / Chromium snapshot DL / os/exec 起動
│   ├── cdp/             # 自作 CDP クライアント (WS + JSON-RPC)
│   ├── collector/       # network / console / performance ドメイン購読
│   └── events/          # 共通 Event 型
├── web/                 # http.Handler + WS hub + embed.FS
│   └── frontend/        # React 18 + Vite 5 + TypeScript 5
└── desktop/             # 将来の Wails ラッパ枠 (今は空)
```

詳細な要件は [requirements.md](requirements.md) を参照。

## ビルド

```bash
make build           # web/frontend をビルドして Go バイナリに同梱
./bin/cdt serve      # http://localhost:7681 で WebUI
```

開発時:

```bash
# terminal 1
cd web/frontend && npm install && npm run dev   # http://localhost:5173

# terminal 2
go run . serve --no-open                        # API/WS を :7681 で提供
```

## CLI

```bash
cdt serve                  # WebUI
cdt watch                  # Chromium を起動して NDJSON を stdout に流す
cdt watch --port 9222      # 既存 Chrome に attach
cdt list  --port 9222      # /json (タブ一覧)
cdt snapshot --port 9222   # Performance.getMetrics を 1 回
```

## Prometheus Exporter (cdt-exporter)

別バイナリ `cdt-exporter` で Chrome DevTools のメトリクスを Prometheus
exposition format で公開する。`node_exporter` と同じ要領で常駐させる。

```bash
make build                                       # bin/cdt-exporter も生成
./bin/cdt-exporter --cdp-port=9222 --listen=:9101  # 既存 Chrome に attach
# あるいは
./bin/cdt-exporter --launch --launch-headless --launch-url=https://example.com
curl http://localhost:9101/metrics
```

主なメトリクス:

| 名前 | 種類 | 説明 |
| --- | --- | --- |
| `chrome_devtools_target_attached` | gauge | 1=attach 中, 0=未接続 |
| `chrome_devtools_target_info{target_url,host,port}` | gauge | attach 中なら 1 |
| `chrome_devtools_jsheap_used_bytes` | gauge | JS heap 使用量 |
| `chrome_devtools_jsheap_total_bytes` | gauge | JS heap 総量 |
| `chrome_devtools_dom_nodes` | gauge | DOM ノード数 |
| `chrome_devtools_js_event_listeners` | gauge | JS イベントリスナー数 |
| `chrome_devtools_documents` | gauge | Document 数 |
| `chrome_devtools_document_frames` | gauge | フレーム数 |
| `chrome_devtools_layout_count_total` | counter | 累積 layout 回数 |
| `chrome_devtools_recalc_style_count_total` | counter | 累積 style 再計算回数 |
| `chrome_devtools_layout_duration_seconds_total` | counter | 累積 layout 時間 |
| `chrome_devtools_recalc_style_duration_seconds_total` | counter | 累積 style 時間 |
| `chrome_devtools_script_duration_seconds_total` | counter | 累積 JS 実行時間 |
| `chrome_devtools_task_duration_seconds_total` | counter | 累積 renderer タスク時間 |
| `chrome_devtools_network_requests_total{method,type}` | counter | 開始したリクエスト数 |
| `chrome_devtools_network_responses_total{status_class,protocol}` | counter | 受信レスポンス数 |
| `chrome_devtools_network_failed_total` | counter | 失敗したリクエスト数 |
| `chrome_devtools_network_bytes_total` | counter | 受信バイト数 |
| `chrome_devtools_console_messages_total{level,source}` | counter | console / Log エントリ |
| `chrome_devtools_exceptions_total` | counter | 未捕捉例外 |

ターゲットが落ちたら 5 秒間隔 (`--retry-interval`) で自動的に再 attach する。

`cdt watch` は `--port` を省略すると Chromium を内蔵 launcher で起動する
(初回のみ `~/.cache/chrome_dev_tool/chromium/<rev>/` に snapshot を DL)。

## Wails (将来)

```bash
go build -tags wails ./...
```

`cli/desktop.go` が `//go:build wails` 配下で `desktop/` を呼ぶ枠だけ持っている。
Wails v2 を `desktop/` に組み込むのは別タスク。

## 検証

```bash
make verify    # go build ./... + go build -tags wails ./... + 依存チェック
```
