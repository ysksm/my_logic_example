# youtube-playlist-manager

YouTube チャンネルを複数登録しておき、**必要なチャンネルだけ・必要なときに** 動画リストを取得して
一覧表示する単一バイナリアプリです（Go + 組み込み Web フロントエンド）。

[`youtube_list`](../youtube_list)（Python + marimo + DuckDB）の取得ロジックを参考にしつつ、
Python ランタイム不要の **実行ファイル 1 つ** で動くように作り直しています。

## 特徴

- **単一バイナリ**：Go 標準ライブラリのみ・cgo なし。HTML/CSS/JS は `embed` で同梱。
  macOS / Windows / Linux 向けにクロスコンパイル可能
- **チャンネル管理**：URL（`/@handle` `/channel/UC…` `/user/…` `/c/…`）・`@handle`・チャンネル ID で登録 / 解除
- **チャンネルごとのオンデマンド取得**（全チャンネル一括では動かさない）
  - ⟳ **差分更新**：新しい順に読み、保存済みの動画に当たったら停止（新着のみ）
  - ⤓ **全動画を取得**：未取得の動画をすべて取得。途中で止まっても（クォータ切れ・中断）次回は続きから
  - ⤓ **古い動画を N 本ずつ**：クォータを少しずつ使いたいとき用
  - ↻ **全動画を再取得**：全動画のタイトル・概要・統計を取り直し、チャンネルから消えた動画を一覧から外す
  - 📊 **統計のみ更新**：保存済み動画の再生回数・いいね・コメント数だけ再取得
  - ☰ **再生リスト一覧を取得** → 各再生リストの動画をすべて取得（再生リスト順で表示可）
- **字幕・文字起こし**（API クォータ不要）
  - チャンネル / 再生リスト単位で「未取得分だけ」または「すべて再取得」、動画 1 本単位でも取得・再取得
  - 日本語の手動字幕 → 日本語の自動生成字幕 → 日本語への自動翻訳 → その他の言語 の順に選択
  - ビューアでタイムスタンプ付き表示・字幕内検索・全文コピー。時刻をクリックするとその位置から再生
- **バックグラウンド実行**：時間のかかる取得は進捗バー付きで裏で実行し、途中で中断可能（取得済みの分は保存）
- **取得項目**：タイトル・概要・いいね数・再生回数・公開日・コメント数（＋サムネイル・動画の長さ）
- **表示**：グリッド / リスト（テーブル）切替、キーワード絞り込み、並び替え（公開日・再生・いいね・コメント・タイトル）
- **クリックで YouTube の動画ページを新しいタブで開く**
- **クォータメーター**：このアプリ経由で消費した本日（太平洋時間）の units を表示。操作ごとの消費量もトースト表示
- **エクスポート**：表示中のリスト（チャンネル / 再生リスト単位）を CSV（Excel 向け BOM 付き）/ JSON で保存。
  「字幕を含める」で字幕の全文も出力

## クォータ設計

YouTube Data API v3 の既定の上限は **10,000 units / 日**（太平洋時間 0 時リセット）。
`search.list` は 1 回 **100 units** と高価なので、動画一覧は使いません。

| 操作 | 使う API | 消費 |
|---|---|---|
| チャンネル登録 | `channels.list`（forHandle / id / forUsername） | 1 |
| 動画 50 件取得（差分更新・全動画・再取得とも） | `playlistItems.list`（uploads 再生リスト） + `videos.list` | 2 |
| 統計更新 | `videos.list` | 保存本数 / 50 |
| 再生リスト一覧 | `playlists.list` | 50 件ごとに 1 |
| 再生リストの動画 50 件 | `playlistItems.list` + `videos.list` | 2 |
| `/c/カスタム名` URL の登録（ハンドルで見つからない場合のみ） | `search.list` | +100 |

例：1,000 本あるチャンネルを全件取得しても約 40 units。差分更新で新着が無ければ 1 unit です。
字幕の取得は Data API を使わないため、クォータを消費しません。

## 使い方

### 1. API キーを用意

Google Cloud Console で **YouTube Data API v3** を有効化し、API キーを作成します。

### 2. ビルド & 起動

```bash
make build
./bin/youtube-playlist-manager          # ブラウザが自動で開きます (http://127.0.0.1:8787)
```

API キーは画面右上の「⚙ 設定」から保存するか、環境変数で渡します（環境変数が優先）。

#### 環境変数での設定方法

環境変数のキーは設定画面で保存したキーより優先され、データファイルには保存されません。
変更後はアプリを再起動してください（設定画面の「環境変数で設定する方法」にも同じ手順を表示しています）。

**macOS / Linux**

```bash
# その場で 1 回だけ
YOUTUBE_API_KEY=AIza... ./bin/youtube-playlist-manager

# 毎回使う（zsh。bash は ~/.bashrc）
echo 'export YOUTUBE_API_KEY=AIza...' >> ~/.zshrc
source ~/.zshrc
```

**Windows（PowerShell）**

```powershell
# その場で 1 回だけ
$env:YOUTUBE_API_KEY = "AIza..."
.\youtube-playlist-manager-windows-amd64.exe

# 毎回使う（設定後、PowerShell を開き直す）
setx YOUTUBE_API_KEY "AIza..."
```

**Windows（コマンドプロンプト）**

```bat
set YOUTUBE_API_KEY=AIza...
youtube-playlist-manager-windows-amd64.exe
```

解除: macOS / Linux は `unset YOUTUBE_API_KEY`（シェル設定ファイルの行も削除）、
Windows は PowerShell で `[Environment]::SetEnvironmentVariable("YOUTUBE_API_KEY", $null, "User")`。

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
| `-transcript-delay` | | `1.5s` | 字幕を一括取得するときの動画ごとの待ち時間（短くしすぎると YouTube にブロックされやすい） |
| `-api-base` | `YPM_API_BASE` | Google の API | API のベース URL（テスト用） |
| `-youtube-base` | `YPM_YOUTUBE_BASE` | `https://www.youtube.com` | 字幕取得先のベース URL（テスト用） |
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
│   ├── store/                  # JSON ファイル永続化（チャンネル / 動画 / 再生リスト / クォータ / 字幕の索引）
│   ├── transcript/             # 字幕の取得（watch ページ → innertube player → timedtext）
│   ├── jobs/                   # バックグラウンドジョブ（進捗・中断）
│   ├── service/                # ユースケース（登録・差分/全件/再取得・統計更新・再生リスト・字幕）
│   └── web/                    # REST API + 埋め込み SPA（static/index.html, app.js, style.css）
└── Makefile
```

### 取得位置の管理

各チャンネルは uploads 再生リストの **続きのページトークン**（`olderPageToken`）と
**末尾到達フラグ**（`reachedEnd`）を保存します。

- 動画は 50 本（1 ページ）ごとに保存し、同時にトークンも更新します。途中で失敗・中断しても取得済みの分は残ります
- 初回の「差分更新」「全動画を取得」：先頭から読み、続きのトークンを保存
- 「古い動画を N 本ずつ」：保存したトークンから N 本（保存済みの動画はスキップして数えない）
- 2 回目以降の「差分更新」：先頭から読み、保存済みの動画を含むページで停止（トークンは動かさない）
- 「全動画を取得」：差分更新 → 保存したトークンから末尾まで
- 「全動画を再取得」：先頭から末尾まで全ページを読み直し、最後まで読めた場合だけ一覧に無い動画を削除

### 字幕の保存

字幕の本文は `data.json` と同じフォルダの `transcripts/<動画ID>.json` に 1 本ずつ保存し、
`data.json` には索引（取得状態・言語・文字数）だけを持ちます。状態は `ok`（取得済み）・`none`（字幕なし）・
`error`（失敗。「未取得分を取得」で再試行）の 3 つです。

字幕は YouTube の公開ページから取得しています（Python の `youtube-transcript-api` と同じ方式）。
公式 API ではないため、YouTube 側の仕様変更で取得できなくなる可能性があります。
また、クラウドサーバーなどデータセンターの IP からは「ボットではないことを確認」で拒否されることが多く、
自宅など一般の回線から使う前提です。短時間に大量に取得するとブロックされることがあり、その場合は一括取得を中断します。

## API

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/status` | API キーの有無・本日のクォータ使用量 |
| PUT | `/api/settings` | `{"apiKey": "...", "dailyLimit": 10000}` |
| GET | `/api/channels` | 登録チャンネル一覧 |
| POST | `/api/channels` | `{"input": "https://www.youtube.com/@handle"}` で登録 |
| DELETE | `/api/channels/{id}` | 登録解除（`?purge=false` で動画を残す） |
| POST | `/api/channels/{id}/refresh` | チャンネル情報を再取得 |
| POST | `/api/channels/{id}/fetch?mode=latest\|all\|older\|refetch&max=100` | 動画取得（ジョブ） |
| POST | `/api/channels/{id}/refresh-stats` | 保存済み動画の統計更新（ジョブ） |
| POST | `/api/channels/{id}/playlists/fetch` | 再生リスト一覧取得（ジョブ） |
| POST | `/api/channels/{id}/transcripts?mode=missing\|all` | チャンネルの字幕取得（ジョブ） |
| GET | `/api/playlists?channelId=` | 保存済み再生リスト |
| POST | `/api/playlists/{id}/fetch?max=0` | 再生リストの動画取得（ジョブ・0 = 全件） |
| POST | `/api/playlists/{id}/transcripts?mode=missing\|all` | 再生リストの字幕取得（ジョブ） |
| GET | `/api/videos?channelId=&playlistId=` | 保存済み動画（`transcriptStatus` 付き） |
| GET | `/api/videos/{id}/transcript` | 保存済みの字幕 |
| POST | `/api/videos/{id}/transcript` | 1 本の字幕を取得・再取得（同期） |
| GET | `/api/jobs` | 実行中・最近のジョブと進捗 |
| POST | `/api/jobs/{id}/cancel` | ジョブの中断 |
| GET | `/api/export?format=csv\|json&channelId=&playlistId=&transcripts=1` | エクスポート（`transcripts=1` で字幕全文付き） |

「ジョブ」と書いたものは `202 Accepted` で `{"job": {...}}` を返し、裏で実行されます。進捗は `GET /api/jobs` で確認できます。

## テスト

```bash
make test
```

`internal/service` のテストは偽の YouTube API サーバ（`httptest`）を立てて、
差分取得・続き取得・全件取得・再取得（削除された動画の除去）・途中失敗からの再開・消費 units・永続化を検証しています。
`internal/transcript` は実際の watch ページ / innertube / timedtext の応答形式を模した偽サーバで、
字幕の選択順・HTML エンティティ・同意画面・ブロック検知を検証しています。
