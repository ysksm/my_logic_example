# URL・ルーティング・CORS ステップバイステップ学習

HTML と素の JavaScript で、URL の扱い方を 7 ステップで学ぶサンプル集です。
各ステップは独立した HTML ページで、解説用のスライド（`slides.html`）も付いています。

## はじめかた

```bash
cd url-routing-cors-learning
node server.js          # Node.js 18 以上。npm install は不要
# → http://localhost:3000/ をブラウザで開く
# → スライドは http://localhost:3000/slides.html
```

ポートが使用中のときは `APP_PORT=3100 API_PORT=4100 node server.js` で変更できます。

STEP 3・5・6・7 はサーバーの挙動を見るので、必ず `server.js` 経由で開いてください
（`file://` や `python -m http.server` では再現できません）。
`localhost` と `127.0.0.1` は別オリジン扱いになるため、URL は `http://localhost:3000/` で統一してください。

## 構成

```
server.js               2 つのサーバーを起動（依存なし）
                          :3000 APP … 静的ファイル / サーバーサイドルーティング / SPA フォールバック
                          :4000 API … CORS デモ用エンドポイント + 受信ログ (/__log)
index.html              目次
slides.html             解説スライド（← → キーで移動、#step1〜#step7 で各章へ）
common.css, cors-log.js 共通スタイル / CORS ページ用の受信ログ表示
step01-url-anatomy/     URL の構造
step02-query-params/    クエリパラメーター（index.html → receive.html へ値を渡す）
step03-server-routing/  サーバーサイドルーティングの解説（実体は server.js の /server/*）
step04-hash-routing/    ハッシュルーティング
step05-history-routing/ History API ルーティング（/step05-history-routing/app/* はフォールバック）
step06-cors-basics/     CORS の基本
step07-cors-advanced/   CORS 応用（プリフライト・Expose-Headers・credentials）
```

## 学習ステップ

| # | テーマ | 学べること |
|---|--------|-----------|
| 01 | URL の構造 | `new URL()` で protocol / host / port / pathname / search / hash / origin に分解。`location`、`hashchange`、`pushState` |
| 02 | クエリパラメーター | form GET でページ間受け渡し、`URLSearchParams` での組み立てとエンコード、`replaceState` で画面状態を URL に保存、XSS 対策 |
| 03 | サーバーサイドルーティング | ルーティングテーブルと `:id` パラメーター、サーバー側でのクエリ読み取り、404、フルリロード |
| 04 | ハッシュルーティング | `location.hash` + `hashchange` のミニ SPA。サーバーへリクエストが飛ばないことを確認 |
| 05 | History API ルーティング | リンク横取り + `pushState` + `popstate`。リロード時に必要なサーバーのフォールバック、絶対パスの必要性 |
| 06 | CORS の基本 | オリジンの判定、ACAO なし / `*` / 許可リスト、ブロックされてもリクエストは届いていること、`mode: "no-cors"` |
| 07 | CORS 応用 | 単純リクエストとプリフライト、許可されないヘッダーで本番が送られないこと、`Expose-Headers`、Cookie と `credentials`、実務用ミドルウェア |

## API サーバー (:4000) のエンドポイント

| パス | 返す CORS ヘッダー | 用途 |
|------|-------------------|------|
| `/basic/no-cors` | なし | ブロックされる例 |
| `/basic/wildcard` | `Allow-Origin: *` | 誰でも読める |
| `/basic/allowlist` | 許可リストにある Origin を返す + `Vary: Origin` | 許可リスト方式 |
| `/advanced/preflight-ok` | OPTIONS に Methods / Headers / Max-Age を返す | プリフライト成功 |
| `/advanced/preflight-ng` | `X-Demo-Token` を許可しない | プリフライト失敗 |
| `/advanced/expose` | `Expose-Headers: X-Total-Count` | ヘッダー公開 |
| `/advanced/login`, `/me`, `/logout` | 具体的 Origin + `Allow-Credentials: true` | Cookie の送受信 |
| `/advanced/me-wildcard` | `Allow-Origin: *` + `Allow-Credentials: true` | よくある間違い |
| `/__log` | `*` | 受信リクエストのログ（`?clear=1` で消去） |
