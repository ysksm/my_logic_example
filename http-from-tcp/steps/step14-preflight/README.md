# step14: プリフライト

## step13からの差分

- APIが `OPTIONS`（プリフライト）に応答するようになる
- `Access-Control-Request-Method` / `-Headers` を読んで
  `Access-Control-Allow-Methods` / `-Headers` で答える

step09 で `OPTIONS` を「このURLで何ができるかを尋ねるメソッド」として実装しました。
プリフライトはその発想を、**ブラウザが自動でやる**ものです。

## やりとりの全体像

```
（ブラウザが「これは単純リクエストではない」と判断する）

→ OPTIONS /api/ok HTTP/1.1
   Origin: http://localhost:8080
   Access-Control-Request-Method: PUT            ← これから使いたいメソッド
   Access-Control-Request-Headers: content-type  ← これから付けたいヘッダー

← HTTP/1.1 204 No Content
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
   Access-Control-Allow-Headers: Content-Type, X-Demo

（ここで初めて本番が送られる）

→ PUT /api/ok HTTP/1.1
   Origin: http://localhost:8080
   Content-Type: application/json

← HTTP/1.1 200 OK
   Access-Control-Allow-Origin: *      ← 本番にも必要
```

**プリフライトが通らなければ、本番のリクエストは送られません。**
「送ってみてダメだった」ではなく「**送る前に諦める**」のがプリフライトです。

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開いてください。
プリフライトが飛ぶとコンソールに `★` が出ます。

## 3種類のエンドポイント

| パス | プリフライト応答 | 本番応答のACAO |
|---|---|---|
| `/api/ok` | 正しく返す | あり |
| `/api/strict` | 返さない（404） | あり |
| `/api/preflight-only` | 正しく返す | **無し** |

## 実験1 — 成功する例（①〜④）

① POST + JSON、② PUT、③ DELETE、④ GET + 独自ヘッダー `X-Demo`。

どれもコンソールに

```
★ これはプリフライトです
    これから使いたいメソッド : PUT
    これから付けたいヘッダー : content-type
```

が出てから、本番が届きます。

**④ に注目してください。GET でもプリフライトが飛びます。**
独自ヘッダーを1つ付けただけで「単純リクエスト」の条件を外れるからです。
`Authorization: Bearer ...` を付けるAPIがプリフライトを避けられないのはこれが理由です。

## 実験2 — ⑤ プリフライトに応答しないAPI

`/api/strict` は `OPTIONS` に 404 を返します。

コンソールを見ると、**`OPTIONS` は届いているが `POST` は届いていません。**
ブラウザは許可が取れなかったので、本番を送るのをやめました。

## 実験3 — ⑥ 許可されていないヘッダー

`X-Secret` を付けると、プリフライトの段階で失敗します。

```
これから付けたいヘッダー : x-secret
```

サーバは `Access-Control-Allow-Headers: Content-Type, X-Demo` としか答えないので、
ブラウザは「`X-Secret` は許可されていない」と判断します。

**`Access-Control-Allow-Headers` に挙げていないヘッダーは使えません。**
実務で `Authorization` や `X-Requested-With` を追加したときに突然壊れるのは、
たいていこれです。

## 実験4 — ⑦ プリフライトは通るが本番にACAOが無い

これが一番わかりにくいパターンです。コンソールを見ると:

- `★` プリフライトが通っている
- 本番の `PUT` も**届いている**（サーバは 200 を返している）
- それでもJSは読めない

**プリフライトは「入場許可」、本番のACAOは「閲覧許可」です。両方必要です。**

サーバのCORS設定を `OPTIONS` のときだけ書いて、
本番のレスポンスに付け忘れる——実務で非常に多いミスです。

## プリフライトが飛ぶ条件（まとめ）

| やること | プリフライト |
|---|---|
| `GET` / `HEAD` | 飛ばない |
| `POST` + `text/plain` / `x-www-form-urlencoded` / `multipart/form-data` | 飛ばない |
| `POST` + `application/json` | **飛ぶ** |
| `PUT` / `DELETE` / `PATCH` | **飛ぶ** |
| 独自ヘッダーを付ける（メソッド問わず） | **飛ぶ** |

## curlでプリフライトを手動再現する

```sh
curl -i -X OPTIONS \
  -H 'Origin: http://localhost:8080' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type' \
  http://localhost:8081/api/ok
```

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Demo
```

**ブラウザがやっていることは、これだけです。** 魔法ではありません。

## 実装のポイント

```js
// プリフライトかどうかの見分け方
if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
  // Access-Control-Request-Method があれば、それはプリフライト
}
```

`OPTIONS` が来ただけではプリフライトとは限りません（step09 のような普通の `OPTIONS` もある）。
`Access-Control-Request-Method` の有無で判定します。

プリフライトの応答は **2xx** である必要があります。
`204 No Content` が最も自然です（ボディは不要なので）。

## 確認

- プリフライトが失敗したら、本番リクエストはサーバに届きますか？
- `GET` でプリフライトが飛ぶのはどんなときですか？
- プリフライトのレスポンスにだけCORSヘッダーを書くと、なぜ動かないのですか？
