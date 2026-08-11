# step05: レスポンスを組み立てる ＋ keep-alive

このステップで作る「HTTPコア」を **step06 以降ずっと使い回します**。
ここだけは少し長いですが、以降のステップでは「HTTPコア」部分は変わりません。

## step04からの差分

1. **リクエストを読み切ったらバッファから取り除き、`while` でもう一度読む**
   → 1本のTCP接続で複数リクエストを処理できる（keep-alive）
2. レスポンス組み立ての部品 `res.send()` / `res.text()` / `res.html()` / `res.json()`

## keep-alive とは

HTTP/1.0 は「1リクエスト＝1接続」でした。TCP接続の確立には往復が必要なので、
画像が20個あるページなら20回の接続確立が発生します。

HTTP/1.1 は**既定で接続を使い回します**。閉じたい側が `Connection: close` と宣言します。

```
[1本のTCP接続]
  → GET /plain HTTP/1.1 ... \r\n\r\n
  ← HTTP/1.1 200 OK ... \r\n\r\n ただのテキストです
  → GET /json HTTP/1.1 ... \r\n\r\n     ← 同じ接続で続けて送れる
  ← HTTP/1.1 200 OK ... \r\n\r\n {...}
```

だからサーバ側は「読み切った分を捨てて、まだバッファに残りがあれば次のリクエストとして読む」
という `while` ループが必要になります。

## 起動

```sh
node server.js
```

## 実験1 — 1本の接続で2リクエスト

```sh
curl -v http://localhost:8080/plain http://localhost:8080/json
```

curl の出力に注目:

```
* Re-using existing connection with host localhost
```

サーバのコンソールには

```
──── ▼ 受信 [この接続の 1 本目] ────
──── ▼ 受信 [この接続の 2 本目] ────
```

**わかること:** 接続は1本、リクエストは2つ。だからループが要る。

## 実験2 — パイプライン（2つを一度に流し込む）

```sh
printf 'GET /plain HTTP/1.1\r\nHost: x\r\n\r\nGET /json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n' | nc localhost 8080
```

**1回の `data` イベントで2リクエストが同時に届きます。**
それでも `while` ループのおかげで両方に応答が返ります。

これが「TCPにはメッセージの境界がない」ことの実感です。
届いたバイト列を自分で切り分けるのは、完全にアプリケーション側の責任です。

## 実験3 — Connection: close

```sh
curl -v -H 'Connection: close' http://localhost:8080/plain
```

応答が `Connection: close` になり、すぐ切断されます。

## 実験4 — 204 No Content

```sh
curl -v http://localhost:8080/empty
```

```
< HTTP/1.1 204 No Content
< Connection: keep-alive
```

`Content-Length` がありません。**204 と 304 はボディを持てない**ため、
`Content-Length` を付けてはいけません（付けるとクライアントが混乱します）。

## HTTPコアのAPI

以降のステップではこれを使ってアプリを書きます。

```js
req.method    // "GET"
req.target    // "/items?q=1"
req.path      // "/items"
req.query     // "q=1"
req.headers   // { host: "...", "content-type": "..." }  ← 小文字キー
req.body      // Buffer

res.text(200, "こんにちは\n")
res.html(200, "<h1>hi</h1>")
res.json(200, { ok: true })
res.send(204)
res.send(200, { "X-Custom": "1", "Set-Cookie": ["a=1", "b=2"] }, "body")
```

`res.send` のヘッダー値に**配列**を渡すと、同じヘッダー名の行が複数出ます。
`Set-Cookie` は連結してはいけない唯一の例外なので、step10 でこれを使います。

## 確認

- なぜ `while` ループが必要なのですか？
- `Connection: close` を送るのはクライアントとサーバのどちらでもよいですか？
- 204 に `Content-Length: 0` を付けてはいけないのはなぜでしょう？
