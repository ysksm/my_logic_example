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
