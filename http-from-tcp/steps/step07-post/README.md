# step07: POST

## step06からの差分

**HTTPコアは変更ありません。**

- `Content-Type` を見て、ボディの読み方を切り替える
- 対応していない形式には `415 Unsupported Media Type` を返す

## Content-Type がすべてを決める

ボディはただのバイト列です。それが何なのかを教えるのが `Content-Type` です。

| Content-Type | ボディの形 | 誰が使う |
|---|---|---|
| `application/x-www-form-urlencoded` | `name=taro&age=20` | HTMLフォーム（既定） |
| `application/json` | `{"name":"taro"}` | fetch / APIクライアント |
| `text/plain` | ただの文字列 | 単純な用途 |
| `multipart/form-data` | 境界文字列で区切る | ファイルアップロード |

`Content-Type: application/json; charset=utf-8` のように**パラメータが付く**ので、
`;` より前だけを見て判定します。

## 起動

```sh
node server.js
```

## 実験1 — HTMLフォームのPOST

ブラウザで `http://localhost:8080/` を開き、1つ目のフォームを送信してください。

サーバのコンソールの生の通信:

```
POST /submit HTTP/1.1\r\n
Content-Type: application/x-www-form-urlencoded\r\n
Content-Length: 41\r\n
\r\n
name=%E5%B1%B1%E7%94%B0+%E5%A4%AA%E9%83%8E&age=20
```

**GET（step06）との比較:**

| | GET | POST |
|---|---|---|
| データの場所 | URL（リクエストライン） | ボディ |
| アドレスバー | `?name=...` が付く | `/submit` のまま |
| 履歴・ログ | 残る | 残らない |
| 書式 | 同じ（`name=value&...`） | 同じ |

**書式は同じ**というのが重要です。だから `parseUrlEncoded()` は
クエリ文字列にもフォームボディにも使い回せます。

## 実験2 — JSONのPOST

トップページの「JSONを送信」ボタンを押すか:

```sh
curl -v -H 'Content-Type: application/json' \
     -d '{"name":"太郎","tags":["a","b"]}' http://localhost:8080/submit
```

`Content-Type` が違うだけで、サーバが `JSON.parse` に切り替わります。

## 実験3 — 415 Unsupported Media Type

```sh
curl -v -H 'Content-Type: application/xml' -d '<a/>' http://localhost:8080/submit
```

```
< HTTP/1.1 415 Unsupported Media Type
```

**わかること:** 415 は「文法は正しいが、この形式は受け付けない」。
400（そもそもリクエストが壊れている）とは別物です。

## 実験4 — Content-Typeを詐称する

```sh
curl -H 'Content-Type: application/json' -d 'name=taro' http://localhost:8080/submit
```

`400` が返ります。サーバは `Content-Type` を信じて `JSON.parse` し、失敗します。

**わかること:** `Content-Type` は宣言にすぎず、中身とは無関係です。
サーバ側は必ず「宣言どおりでなかった場合」を処理する必要があります。

## 補足：POSTとPUTの違い（次のステップ）

- `POST /items` … 「このコレクションに追加して」。**場所はサーバが決める**
- `PUT /items/99` … 「この場所の中身をこれにして」。**場所はクライアントが決める**

## 確認

- `Content-Type` が無いPOSTが来たら、サーバはボディをどう扱うべきですか？
- 400 と 415 の違いは何ですか？
- HTMLフォームは `Content-Type: application/json` で送れますか？（`<form>` の仕様を調べてみてください）
