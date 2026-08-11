# step09: DELETE と適切な応答

## step08からの差分

**HTTPコアは変更ありません。**

- `DELETE` の実装（成功したら `204 No Content`）
- `405 Method Not Allowed` に **`Allow` ヘッダー**を必ず付ける
- **`OPTIONS` に応答する** ← ここで初登場。step14のプリフライトで再会します

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開くとボタンで試せます。

## 実験1 — DELETEは2回目も204

```sh
curl -i -X DELETE http://localhost:8080/items/1
curl -i -X DELETE http://localhost:8080/items/1
```

どちらも `204 No Content` です。

「もう無いのだから404では？」と思うかもしれませんが、
DELETEの目的は**「そのURLに何も無い状態にすること」**です。
2回目もその状態は達成されているので、成功を返すのが自然で、
これによりDELETEは**冪等**になります。

（404を返す設計もありえますが、その場合クライアントは
「再送していいのか」を判断しにくくなります。）

## 実験2 — 204にはボディもContent-Lengthも無い

```sh
curl -i -X DELETE http://localhost:8080/items/2
```

```
HTTP/1.1 204 No Content
Connection: keep-alive

```

`Content-Length` が**ありません**。`204` と `304` はボディを持てないため、
`Content-Length: 0` すら付けてはいけません。

## 実験3 — 405 には Allow を付ける

```sh
curl -i -X PATCH http://localhost:8080/items/1
```

```
HTTP/1.1 405 Method Not Allowed
Allow: GET, PUT, DELETE, OPTIONS
```

**`Allow` は405のとき必須です（RFC 9110）。**
「ダメです」だけでなく「これならできます」を返すのがHTTPの作法です。

## 実験4 — OPTIONS：このURLで何ができる？

```sh
curl -i -X OPTIONS http://localhost:8080/items/1
curl -i -X OPTIONS http://localhost:8080/items
```

```
HTTP/1.1 204 No Content
Allow: GET, PUT, DELETE, OPTIONS
```

```
HTTP/1.1 204 No Content
Allow: GET, POST, OPTIONS
```

**わかること:** `OPTIONS` は「実際に何かをする」のではなく、
**「このURLに対して何ができるのか」を尋ねるだけ**のメソッドです。
安全（状態を変えない）で冪等です。

> **これがCORSのプリフライトの正体です。**
> step14 でブラウザが**勝手に** `OPTIONS` を送る場面に出会います。
> そのとき「ああ、あの『何ができるか尋ねるメソッド』か」と思い出してください。
> ただし CORS のプリフライトは `Allow` ではなく
> `Access-Control-Allow-Methods` という別のヘッダーで答えます。

## ステータスコードの選び方（この教材の範囲）

| コード | 意味 | 使う場面 |
|---|---|---|
| `200 OK` | 成功。ボディあり | GET、更新したPUT |
| `201 Created` | 作った。`Location` を付ける | POST、新規のPUT |
| `204 No Content` | 成功。返す中身なし | DELETE、OPTIONS |
| `400 Bad Request` | リクエストが壊れている | JSONが不正 |
| `404 Not Found` | そのURLに何もない | 存在しないid |
| `405 Method Not Allowed` | URLはあるがメソッドが違う。`Allow` 必須 | `PATCH /items/1` |
| `415 Unsupported Media Type` | Content-Typeが非対応 | XMLを送ってきた |

`404` と `405` の違いに注意してください。
**URLが存在しない**のが404、**URLはあるがそのメソッドは使えない**のが405です。

## 第2章のまとめ

| メソッド | 安全 | 冪等 | ボディ | 典型的な成功応答 |
|---|:---:|:---:|:---:|---|
| GET | ○ | ○ | なし | 200 |
| POST | × | × | あり | 201 + Location |
| PUT | × | ○ | あり | 201 + Location / 200 |
| DELETE | × | ○ | なし | 204 |
| OPTIONS | ○ | ○ | なし | 204 + Allow |

次の第3章では、ステートレスなHTTPに「状態」を持たせる Cookie を扱います。

## 確認

- `404` と `405` はどう使い分けますか？
- DELETEの2回目が `204` なのはなぜですか？
- `OPTIONS` は何をするメソッドですか？（step14で必ず思い出してください）
