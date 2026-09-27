# youtube-playlist-manager

YouTube チャンネルを複数登録しておき、**必要なチャンネルだけ・必要なときに** 動画リストを取得して
一覧表示する単一バイナリアプリです（Go + 組み込み Web フロントエンド）。

[`youtube_list`](../youtube_list)（Python + marimo + DuckDB）の取得ロジックを参考にしつつ、
Python ランタイム不要の **実行ファイル 1 つ** で動くように作り直しています。

## 特徴

- **単一バイナリ**：Go 標準ライブラリのみ・cgo なし。HTML/CSS/JS は `embed` で同梱。
  macOS / Windows / Linux 向けにクロスコンパイル可能
- **チャンネル管理**：URL（`/@handle` `/channel/UC…` `/user/…` `/c/…`）・`@handle`・チャンネル ID で登録 / 解除
- **オンデマンド取得**（クォータ節約のため一括取得はしない）
  - ⟳ **最新の動画を取得**：新しい順に読み、保存済みの動画に当たったら停止（差分更新）
  - ⤓ **さらに古い動画を取得**：前回の続きから古い動画を N 件ずつ
  - 📊 **統計を更新**：保存済み動画の再生回数・いいね・コメント数だけ再取得
  - ☰ **再生リスト一覧を取得** → 各再生リストの動画を個別に取得（再生リスト順で表示可）
- **取得項目**：タイトル・概要・いいね数・再生回数・公開日・コメント数（＋サムネイル・動画の長さ）
- **表示**：グリッド / リスト（テーブル）切替、キーワード絞り込み、並び替え（公開日・再生・いいね・コメント・タイトル）
- **クリックで YouTube の動画ページを新しいタブで開く**
- **クォータメーター**：このアプリ経由で消費した本日（太平洋時間）の units を表示。操作ごとの消費量もトースト表示
- **エクスポート**：表示中のリスト（チャンネル / 再生リスト単位）を CSV（Excel 向け BOM 付き）/ JSON で保存

## クォータ設計

YouTube Data API v3 の既定の上限は **10,000 units / 日**（太平洋時間 0 時リセット）。
`search.list` は 1 回 **100 units** と高価なので、動画一覧は使いません。

| 操作 | 使う API | 消費 |
|---|---|---|
| チャンネル登録 | `channels.list`（forHandle / id / forUsername） | 1 |
| 動画 50 件取得 | `playlistItems.list`（uploads 再生リスト） + `videos.list` | 2 |
| 統計更新 | `videos.list` | 保存本数 / 50 |
| 再生リスト一覧 | `playlists.list` | 50 件ごとに 1 |
| 再生リストの動画 50 件 | `playlistItems.list` + `videos.list` | 2 |
| `/c/カスタム名` URL の登録（ハンドルで見つからない場合のみ） | `search.list` | +100 |

例：1,000 本あるチャンネルを全件取得しても約 40 units。差分更新で新着が無ければ 1 unit です。

## 使い方

### 1. API キーを用意

Google Cloud Console で **YouTube Data API v3** を有効化し、API キーを作成します。

### 2. ビルド & 起動

```bash
make build
./bin/youtube-playlist-manager          # ブラウザが自動で開きます (http://127.0.0.1:8787)
```

API キーは画面右上の「⚙ 設定」から保存するか、環境変数で渡します（環境変数が優先）。

```bash
YOUTUBE_API_KEY=AIza... ./bin/youtube-playlist-manager
```

### 3. 配布用バイナリ

```bash
make dist
# dist/youtube-playlist-manager-darwin-arm64
# dist/youtube-playlist-manager-darwin-amd64
# dist/youtube-playlist-manager-windows-amd64.exe
# dist/youtube-playlist-manager-linux-amd64
```

### オプション

| フラグ | 環境変数 | 既定値 | 説明 |
|---|---|---|---|
| `-addr` | | `127.0.0.1:8787` | 待ち受けアドレス |
| `-data` | `YPM_DATA` | `<UserConfigDir>/youtube-playlist-manager/data.json` | データファイル |
| `-open` | | `true` | 起動時にブラウザを開く |
| `-api-base` | `YPM_API_BASE` | Google の API | API のベース URL（テスト用） |
| | `YOUTUBE_API_KEY` | | API キー（設定画面の値より優先） |
| `-version` | | | バージョン表示 |

データファイルの場所（既定）：macOS `~/Library/Application Support/…`、Windows `%AppData%\…`、Linux `~/.config/…`。
API キーもこのファイルに平文で保存されます（パーミッション 0600）。

## 構成

```
youtube-playlist-manager/
├── main.go                     # フラグ解析・サーバ起動・ブラウザ起動
├── internal/
│   ├── youtube/                # YouTube Data API v3 の最小クライアント（コスト通知付き）
│   ├── store/                  # JSON ファイル永続化（チャンネル / 動画 / 再生リスト / クォータ）
│   ├── service/                # ユースケース（登録・差分取得・続き取得・統計更新・再生リスト）
│   └── web/                    # REST API + 埋め込み SPA（static/index.html, app.js, style.css）
└── Makefile
```

### 取得位置の管理

各チャンネルは uploads 再生リストの **続きのページトークン**（`olderPageToken`）と
**末尾到達フラグ**（`reachedEnd`）を保存します。

- 初回の「最新を取得」：先頭から N 件取得し、続きのトークンを保存
- 「さらに古い動画」：保存したトークンから N 件（保存済みの動画はスキップして数えない）
- 2 回目以降の「最新を取得」：先頭から読み、保存済みの動画を含むページで停止（トークンは動かさない）

## API

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/status` | API キーの有無・本日のクォータ使用量 |
| PUT | `/api/settings` | `{"apiKey": "...", "dailyLimit": 10000}` |
| GET | `/api/channels` | 登録チャンネル一覧 |
| POST | `/api/channels` | `{"input": "https://www.youtube.com/@handle"}` で登録 |
| DELETE | `/api/channels/{id}` | 登録解除（`?purge=false` で動画を残す） |
| POST | `/api/channels/{id}/refresh` | チャンネル情報を再取得 |
| POST | `/api/channels/{id}/fetch?mode=latest\|older&max=50` | 動画取得 |
| POST | `/api/channels/{id}/refresh-stats` | 保存済み動画の統計更新 |
| POST | `/api/channels/{id}/playlists/fetch` | 再生リスト一覧取得 |
| GET | `/api/playlists?channelId=` | 保存済み再生リスト |
| POST | `/api/playlists/{id}/fetch?max=200` | 再生リストの動画取得 |
| GET | `/api/videos?channelId=&playlistId=` | 保存済み動画 |
| GET | `/api/export?format=csv\|json&channelId=&playlistId=` | エクスポート |

## テスト

```bash
make test
```

`internal/service` のテストは偽の YouTube API サーバ（`httptest`）を立てて、
差分取得・続き取得・末尾到達・消費 units・永続化を検証しています。
