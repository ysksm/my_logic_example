# step17: Access-Control-Expose-Headers

## step16からの差分

- レスポンス**ヘッダー**は、クロスオリジンでは既定でJSから読めない
- `Access-Control-Expose-Headers` で「読んでよいヘッダー」を指定する

## 問題

CORSが制限しているのはボディだけではありません。

```js
const r = await fetch('http://api.example/items');
console.log(r.headers.get('X-Total-Count'));  // → null
```

サーバはちゃんと返しています。DevTools の Network タブにも表示されています。
それでも `null` です。

**DevToolsに見えている＝JSから読める、ではありません。**
DevToolsはブラウザの内部を見ているだけで、JSに渡されるものとは別です。

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開いてください。

## 実験

| ボタン | エンドポイント | Expose-Headers | 読めるヘッダー |
|---|---|---|---|
| ① | クロス `/api/hidden` | 無し | `Cache-Control`, `Content-Type` のみ |
| ② | クロス `/api/exposed` | `X-Total-Count, X-Request-Id` | 上記 + 指定した2つ |
| ③ | クロス `/api/exposed-all` | `*` | 全部 |
| ④ | 同一 `/api/same-origin` | 無し | **全部** |

② で `X-Rate-Limit-Remaining` だけ読めないことに注目してください。
列挙していないからです。

④ が重要です。**同一オリジンなら何も指定しなくても全部読めます。**
この制限はクロスオリジンのときだけのものです。

## 指定しなくても読める7つ

「CORSセーフリスト済みレスポンスヘッダー」と呼ばれます。

- `Cache-Control`
- `Content-Language`
- `Content-Length`
- `Content-Type`
- `Expires`
- `Last-Modified`
- `Pragma`

これ以外はすべて、サーバが明示的に公開しない限り読めません。

## 実務でつまずく場面

| 返しているもの | 症状 |
|---|---|
| `X-Total-Count`（総件数） | ページネーションの総ページ数が計算できない |
| `X-RateLimit-Remaining` | 残り回数が表示できない |
| `Location`（作成したリソースのURL） | `201 Created` の後どこに移動すればいいかわからない |
| `Content-Disposition`（ファイル名） | ダウンロードファイル名が取れない |

いずれも「サーバは返しているのにフロントで `null`」という形で現れます。
サーバのログにもDevToolsにもヘッダーが見えているので、原因に気づきにくいのが厄介です。

```
Access-Control-Expose-Headers: X-Total-Count, Location, Content-Disposition
```

## `*` の注意点

`Access-Control-Expose-Headers: *` はワイルドカードとして機能しますが、
**`credentials: 'include'` のリクエストでは無効**になり、
「`*` という名前のヘッダー」を探す扱いになります。

credentials を使うなら、必ず個別に列挙してください。

同じ制限が `Access-Control-Allow-Headers: *` や
`Access-Control-Allow-Methods: *` にもあります。

## curlでの確認

```sh
curl -i http://localhost:8081/api/hidden
```

`X-Total-Count: 1234` が普通に見えます。
**サーバは常に送っています。ブラウザがJSに渡さないだけです。**

これも step12 と同じ構図です。CORSはブラウザの中だけの仕組みです。

## 確認

- `Content-Type` が指定なしで読めるのはなぜですか？
- 同一オリジンのリクエストで `Access-Control-Expose-Headers` は必要ですか？
- `credentials: 'include'` のとき `Expose-Headers: *` はどう扱われますか？
