# TCPからHTTPを自作する — CORSを深く理解するための19ステップ

ライブラリを一切使わず、Node.js の `net` モジュール（＝生のTCPソケット）だけで
HTTPサーバを1行ずつ組み立てていく学習教材です。

**最終目的は CORS を深く理解すること。** そのために、HTTPの構造・4つのメソッド・
ヘッダー・Cookie を先に手で作り、その土台の上で CORS を1要素ずつ観察します。

## 使い方

### 1. 教材（スライド）を開く

```sh
open docs/index.html      # macOS
xdg-open docs/index.html  # Linux
```

ブラウザで直接ファイルを開くだけです。ビルドもサーバも不要。
矢印キー（← →）でスライドを移動、`a` キーで全スライド一覧表示。

### 2. サンプルコードを動かす

各ステップのディレクトリで `node server.js` を実行するだけです。
**依存パッケージのインストールは不要**（`npm install` は要りません）。

```sh
cd steps/step01-tcp-echo
node server.js
```

### 3. 通信を観察する

サーバは**受信したバイト列と送信したバイト列をそのままコンソールに出力**します。
`\r\n` は見えるように `\r\n` と表示されるので、HTTPの実際の姿がそのまま読めます。

```
──── ▼ 受信 (クライアント → サーバ) ────────────────
GET /hello HTTP/1.1\r\n
Host: localhost:8080\r\n
User-Agent: curl/8.7.1\r\n
\r\n
```

## 前提

| 必要なもの | 確認方法 | 備考 |
|---|---|---|
| Node.js 18 以上 | `node -v` | 標準モジュールのみ使用 |
| curl | `curl --version` | macOS / Linux には標準搭載 |
| Google Chrome | — | 第4章以降のCORS実験で DevTools を使用 |

## 全体構成

### 第1章　TCP から HTTP へ

| # | テーマ | 学ぶこと |
|---|---|---|
| 01 | [TCPエコーサーバ](steps/step01-tcp-echo) | TCPは「バイト列を運ぶ土管」でしかない |
| 02 | [リクエストラインを読む](steps/step02-request-line) | `GET /path HTTP/1.1` の分解、`\r\n` の意味 |
| 03 | [ヘッダーをパースする](steps/step03-headers) | 空行までがヘッダー、大文字小文字非依存 |
| 04 | [ボディを読む](steps/step04-body) | TCPには「メッセージの境界」がない → `Content-Length` |
| 05 | [レスポンスを組み立てる](steps/step05-response) | ステータス行・ヘッダー・ボディ、keep-alive |

### 第2章　4つのメソッド

| # | テーマ | 学ぶこと |
|---|---|---|
| 06 | [GET](steps/step06-get) | クエリ文字列、ルーティング、静的配信 |
| 07 | [POST](steps/step07-post) | フォーム形式とJSONの受け取り分岐 |
| 08 | [PUT](steps/step08-put) | 冪等な更新、`201 Created` と `Location` |
| 09 | [DELETE と適切な応答](steps/step09-delete) | `204` / `404` / `405` と `Allow` ヘッダー |

### 第3章　Cookie

| # | テーマ | 学ぶこと |
|---|---|---|
| 10 | [Cookie の往復](steps/step10-cookie) | `Set-Cookie` と `Cookie` ヘッダー |
| 11 | [Cookie 属性とセッション](steps/step11-cookie-attributes) | Path / Max-Age / HttpOnly / Secure / SameSite |

### 第4章　CORS ― 本題

| # | テーマ | 学ぶこと |
|---|---|---|
| 12 | [同一オリジンポリシー](steps/step12-same-origin) | CORSはブラウザ側の制限。サーバには届いている |
| 13 | [単純リクエストと ACAO](steps/step13-simple-request) | `Access-Control-Allow-Origin`、単純リクエストの条件 |
| 14 | [プリフライト](steps/step14-preflight) | `OPTIONS` の発火条件と応答の作り方 |
| 15 | [Access-Control-Max-Age](steps/step15-max-age) | プリフライトのキャッシュ |
| 16 | [credentials と Cookie](steps/step16-credentials) | `*` が使えなくなる理由、`Vary: Origin` |

### 第5章　実務で効く知識

| # | テーマ | 学ぶこと |
|---|---|---|
| 17 | [Expose-Headers](steps/step17-expose-headers) | レスポンスヘッダーがJSから読めない既定 |
| 18 | [許可リストと落とし穴](steps/step18-origin-allowlist) | Origin反射の危険、`null` origin、CORS≠認証 |

### 特別演習

| # | テーマ | 学ぶこと |
|---|---|---|
| 19 | [同一オリジン化リバースプロキシ](steps/step19-reverse-proxy) | サーバがTCPクライアントになり、オリジンを1つに畳む |

## 設計方針

- **各ステップの `server.js` は完全に独立した1ファイル**です。前のステップのコードをコピーして
  差分を足す形になっているため、行の重複がありますが、ファイルを行き来せずに読めます。
- 各 `server.js` には `▼▼▼ このステップの新しい部分 ▼▼▼` というコメント区切りが入っています。
- 第4章以降は**1プロセスで2つのポートを listen** します。`node server.js` 1回で実験環境が整います。

## 注意

学習用の実装です。チャンク転送エンコーディング、HTTPS/TLS、HTTP/2、圧縮、
タイムアウト、リクエストサイズ上限などは意図的に省いています。
本番では実績のあるサーバ実装を使ってください。
