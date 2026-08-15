# step10: Cookie の往復

## step09からの差分

**HTTPコアは変更ありません。**

- `parseCookie()` — リクエストの `Cookie` ヘッダーを分解する
- レスポンスで `Set-Cookie` を返す

## HTTPはステートレス

HTTPは「1回のやりとりが完結していて、前回のことを覚えていない」プロトコルです。
サーバから見れば、すべてのリクエストは初対面です。

Cookieはこれを回避する仕組みです。仕組み自体はとても単純です。

```
1回目
  →  GET / HTTP/1.1
  ←  HTTP/1.1 200 OK
      Set-Cookie: visits=1; Path=/     ← 「これを持っておいて」

2回目（ブラウザが勝手に付ける）
  →  GET / HTTP/1.1
      Cookie: visits=1                  ← 「持っています」
  ←  HTTP/1.1 200 OK
      Set-Cookie: visits=2; Path=/     ← 「更新して」
```

**サーバは何も覚えていません。** 覚えているのはブラウザです。

## 2つのヘッダーは形が違う

| | ヘッダー | 形 | 個数 |
|---|---|---|---|
| サーバ → ブラウザ | `Set-Cookie` | `名前=値; 属性; 属性` | **1つのCookieにつき1行** |
| ブラウザ → サーバ | `Cookie` | `名前=値; 名前=値` | **全部まとめて1行** |

```
← Set-Cookie: visits=3; Path=/
← Set-Cookie: first_seen=2026-01-01; Path=/

→ Cookie: visits=3; first_seen=2026-01-01
```

リクエスト側には**属性が付いてきません**。
ブラウザは `Path` や `HttpOnly` を自分で使うだけで、サーバには送り返しません。

### Set-Cookie は連結してはいけない唯一のヘッダー

step03 で「同名ヘッダーは `,` で連結する」と書きました。
`Set-Cookie` だけはこの規則の例外です（値の中に `,` を含みうるため）。

だから step05 で作った `res.send` は**配列を渡すと複数行出す**ようにしてあります。

```js
res.send(200, { "Set-Cookie": ["a=1; Path=/", "b=2; Path=/"] }, body);
```

## 起動

```sh
node server.js
```

## 実験1 — ブラウザでリロード

`http://localhost:8080/` を開いて何度もリロードしてください。数字が増えます。

DevTools の Network タブでこのリクエストを選び、以下を見比べてください:

- **Request Headers → Cookie**
- **Response Headers → Set-Cookie**（2行あります）

Application タブ → Cookies でブラウザの保管庫も見られます。

## 実験2 — curlはCookieを覚えない

```sh
curl -s http://localhost:8080/whoami
curl -s http://localhost:8080/whoami
```

どちらも `"visits":1` です。curl は既定でCookieを保存しません。

**わかること:** Cookieを保持するのは**クライアントの機能**であって、HTTPの必須機能ではありません。

## 実験3 — curlにCookieを覚えさせる

```sh
rm -f jar.txt
curl -s -c jar.txt -b jar.txt http://localhost:8080/whoami
curl -s -c jar.txt -b jar.txt http://localhost:8080/whoami
curl -s -c jar.txt -b jar.txt http://localhost:8080/whoami
cat jar.txt
```

`-c`（保存）と `-b`（送信）を付けると数字が増えます。
`jar.txt` を見ると、ブラウザが内部で持っているものと同じ情報が入っています。

## 実験4 — 手でCookieを送る

```sh
curl -s -H 'Cookie: visits=999' http://localhost:8080/whoami
```

`"visits":1000` になります。

**わかること:** Cookieの値は**クライアントが自由に書き換えられます**。
`Cookie: is_admin=true` のような値を信用してはいけません。
step11 で扱う「セッションID方式」はこの問題への答えです。

## 実験5 — Cookieを消す

ブラウザで「Cookieを消す」ボタン（`/reset`）を押してください。
サーバが送っているのはこれです。

```
Set-Cookie: visits=; Max-Age=0; Path=/
```

**「削除」という命令はありません。** 寿命ゼロのCookieを送りつけると、ブラウザが捨てます。

## 値のエンコード

Cookieの値には `;` `,` 空白 などをそのまま入れられません。
このステップの `first_seen` は `encodeURIComponent` してから入れています。

```
Set-Cookie: first_seen=2026-01-01T00%3A00%3A00.000Z; Path=/
```

日本語なども同様にエンコードするのが安全です。

## 確認

- `Set-Cookie` と `Cookie` で形が違うのはなぜですか？
- サーバが「訪問回数」を覚えているわけではないのに数字が増えるのはなぜですか？
- `Cookie: is_admin=true` を信用してはいけないのはなぜですか？
