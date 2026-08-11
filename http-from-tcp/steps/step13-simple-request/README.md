# step13: 単純リクエストと Access-Control-Allow-Origin

## step12からの差分

- APIが `Access-Control-Allow-Origin`（以下 ACAO）を返すエンドポイントを追加
- **単純リクエストなら、この1行だけで通る**

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開いてください。

## 実験A — GET（単純リクエスト）

| ボタン | ACAO | 結果 |
|---|---|---|
| ① `/api/no-cors` | 無し | 失敗 |
| ② `/api/wildcard` | `*` | **成功** |
| ③ `/api/wrong-origin` | `https://example.com` | 失敗 |

③ が重要です。**ヘッダーはあるのに失敗します。**

CORSの判定は「ヘッダーが有るか無いか」ではなく
「**値がこのページのオリジンと一致するか**」です。
`*` は「すべてに一致する特別な値」というだけです。

## 実験B — POSTはContent-Typeで結果が変わる

同じ `/api/wildcard`（ACAO: `*`）に、同じPOSTを送ります。

| ボタン | Content-Type | 結果 |
|---|---|---|
| ④ | `text/plain` | **成功** |
| ⑤ | `application/json` | 失敗 |

サーバのコンソールを比べてください。

- ④ … `POST /api/wildcard` が届いている
- ⑤ … `POST` は届かず、代わりに **`OPTIONS`** が届いている

`application/json` は「単純リクエスト」の条件から外れるため、
ブラウザが本番の前に許可を確認しに行きました。これが**プリフライト**です。
このステップのサーバはまだ `OPTIONS` に応答しないので失敗します（step14で対応）。

## 「単純リクエスト」の条件

次を**すべて**満たすときだけ、プリフライトなしで送られます。

| 項目 | 条件 |
|---|---|
| メソッド | `GET` / `HEAD` / `POST` のいずれか |
| ヘッダー | 手で付けたヘッダーが安全なもの（`Accept`, `Accept-Language`, `Content-Language`, `Content-Type`, `Range` など）だけ。`Authorization` や `X-独自ヘッダー` を1つでも付けると外れる |
| Content-Type | `application/x-www-form-urlencoded` / `multipart/form-data` / `text/plain` のいずれか。**`application/json` は含まれない** |
| その他 | アップロード進捗イベントを使っていない、`ReadableStream` をボディにしていない |

### なぜこの条件なのか

この条件は「**HTMLのフォームで昔から送れたもの**」とほぼ一致します。

```html
<form method="POST" action="https://other.example/api" enctype="text/plain">
```

これはCORSが生まれる前から動きました。今さら止めても、
攻撃者は同じことをフォームでできてしまうので意味がありません。
だから「フォームで送れる範囲」は追加確認なしで通し、
それを超えるもの（`PUT`、`DELETE`、JSON、独自ヘッダー）だけ
事前確認を要求する、という設計になっています。

**ただし「送れる」だけで「読める」わけではありません。**
応答を読むには、いずれの場合も ACAO が必要です。

## `*` と個別指定の使い分け

| | 使う場面 |
|---|---|
| `Access-Control-Allow-Origin: *` | 誰でも使ってよい公開API。Cookieや認証情報を伴わないもの |
| `Access-Control-Allow-Origin: https://app.example.com` | 特定のフロントからだけ使わせたいAPI |

`*` は `credentials`（Cookie）と**併用できません**。step16 で扱います。

## 実験 — curlで確かめる

```sh
curl -i -H 'Origin: http://localhost:8080' http://localhost:8081/api/wildcard
```

`Access-Control-Allow-Origin: *` が返っています。
curl はこのヘッダーを見ても何もしません。**判断するのはブラウザだけ**です。

## 確認

- ACAO の値が `https://example.com` のとき、`http://localhost:8080` のページは読めますか？
- `POST` + `Content-Type: application/json` でプリフライトが飛ぶのはなぜですか？
- 「単純リクエスト」の条件がフォームで送れる範囲とほぼ一致しているのはなぜですか？
