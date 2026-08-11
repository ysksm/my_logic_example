# step16: credentials とクロスオリジンの Cookie

第4章の山場です。ここまでの内容（Cookie・プリフライト・ACAO）が全部つながります。

## step15からの差分

- `fetch` の `credentials: 'include'` を扱う
- `Access-Control-Allow-Credentials: true`
- **このとき `Access-Control-Allow-Origin` に `*` は使えない**
- `Vary: Origin`

## 前提: fetch は既定でCookieを送らない

| `credentials` | 意味 |
|---|---|
| `'omit'` | 絶対に送らない |
| `'same-origin'`（**既定**） | 同一オリジンのときだけ送る |
| `'include'` | クロスオリジンでも送る。**サーバ側の許可が必要** |

`XMLHttpRequest` の `withCredentials = true` が同じ役割です。

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開いてください。
Cookieが届いたかどうかを毎回コンソールに出します。

## 実験1 — ログイン

「POST /api/login」を押します。APIが `Set-Cookie` を返します。

**注意: `Set-Cookie` を受け入れるのにも `credentials: 'include'` が必要です。**
省くと、サーバが `Set-Cookie` を返してもブラウザは保存しません。

DevTools → Application → Cookies → `http://localhost:8081` を確認してください。

## 実験2 — Cookieが送られるかを比べる

| ボタン | credentials | 結果 |
|---|---|---|
| ① | 指定なし（`same-origin`） | `ログイン中: false` |
| ② | `'include'` | `ログイン中: true` |

**① は通信自体は成功しています。** ステータスは 200 です。
ただCookieが送られていないので、サーバから見れば未ログインの他人です。

サーバのコンソール:

```
① Cookie ヘッダー : 届いていません
② Cookie ヘッダー : sid=...
```

「APIは動いているのにログイン状態にならない」という症状の正体がこれです。

## 実験3 — サーバ側の設定ミス2種

### ③ `Access-Control-Allow-Origin: *` ＋ `credentials: 'include'`

失敗します。DevTools の Console:

```
The value of the 'Access-Control-Allow-Origin' header in the response must not be
the wildcard '*' when the request's credentials mode is 'include'.
```

**なぜ禁止されているのか。**

`*` は「誰でもどうぞ」という意味です。
そこにユーザーのCookie（＝本人の権限）が乗ると、
**どんなサイトからでも、そのユーザーとしてAPIを叩いて結果を読める**ことになります。

「誰でも」と「本人の権限」を同時に成立させてはいけない。だからブラウザが拒否します。

### ④ `Allow-Credentials` の付け忘れ

`Access-Control-Allow-Origin` は正しく Origin を返しているのに失敗します。

```
The value of the 'Access-Control-Allow-Credentials' header in the response is ''
which must be 'true' when the request's credentials mode is 'include'.
```

**Origin の一致だけでは足りません。**「Cookieを伴ってよい」という明示的な許可が別途必要です。

## credentials を使うときのサーバ側の条件（全部必要）

```js
function corsWithCredentials(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,        // ← "*" ではなく実際の値
    "Access-Control-Allow-Credentials": "true",   // ← これが無いと通らない
    "Vary": "Origin",                             // ← キャッシュ事故を防ぐ
  };
}
```

1. `Access-Control-Allow-Origin` に **`*` は使えない**。Origin をそのまま返す
2. `Access-Control-Allow-Credentials: true` を返す
3. **プリフライトが飛ぶ場合は、プリフライトの応答にもこの2つが必要**
4. `Vary: Origin` を付ける

### `Vary: Origin` はなぜ必要か

応答内容が `Origin` によって変わるからです。これが無いと、
CDNやプロキシが「A社向けの応答（`Access-Control-Allow-Origin: https://a.example`）」を
キャッシュし、それをB社に配ってしまいます。B社からは読めなくなります。

逆に、許可されていない Origin 向けの「ACAOなし」の応答がキャッシュされ、
正規のオリジンにも配られる、という事故も起きます。

**許可した場合も許可しなかった場合も、必ず `Vary: Origin` を付けてください。**

## 発展（任意）: オリジンとサイトは別物

ここまでの実験では `SameSite=Lax` のままCookieが送られていました。不思議ではありませんか？

**`http://localhost:8080` と `http://localhost:8081` は、別オリジンですが同じサイトです。**

| 概念 | 判定に使うもの |
|---|---|
| **オリジン** | スキーム + ホスト + **ポート** |
| **サイト** | スキーム + 登録可能ドメイン（eTLD+1）。**ポートは無関係** |

`SameSite` 属性が見ているのは「オリジン」ではなく「**サイト**」です。
だからポートが違うだけの今回のケースは「same-site」であり、`Lax` でもCookieが送られます。

### 実験（⑤⑥⑦）

`http://127.0.0.1:8081` にすると**別サイト**になります（ホスト名が違うため）。
同じAPIサーバに別の名前でアクセスするだけです。

1. **⑤** 127.0.0.1 側に `SameSite=Lax` でログイン
   → 応答は成功するが、**Cookieは保存されない**
   （別サイトからのfetchに対する `Lax` Cookie は保存されない）
2. **⑥** 127.0.0.1 側の `/api/me` を呼ぶ → Cookieが届かない
3. **⑦** `SameSite=None; Secure` でログインし直す → 今度は保存される
4. **⑥** をもう一度 → Cookieが届く

DevTools → Application → Cookies → `http://127.0.0.1:8081` で確認してください。

> `Secure` 付きなのに http で動くのは、ブラウザが `localhost` / `127.0.0.1` を
> 例外的に「安全なオリジン」として扱うためです（step11 参照）。
> 本番では本物のHTTPSが必要です。

> **うまくいかない場合**: ブラウザのサードパーティCookieブロックを確認してください。
> Chrome は 設定 → プライバシーとセキュリティ → サードパーティCookie。
> Safari は既定でブロックするため、この発展実験は動きません。

## クロスサイトでCookieを使うための条件（まとめ）

| 層 | 必要なもの |
|---|---|
| Cookie | `SameSite=None; Secure` |
| fetch | `credentials: 'include'` |
| CORS（本番） | `Access-Control-Allow-Origin: <実際のOrigin>` ＋ `Allow-Credentials: true` |
| CORS（プリフライト） | 同上 |
| キャッシュ | `Vary: Origin` |

**5層すべて**が揃わないと動きません。1つでも欠けると失敗します。
「クロスオリジンのCookieがつらい」と言われるのはこのためです。

step19 では、この全部を不要にする方法を扱います。

## 確認

- `credentials: 'include'` のとき `Access-Control-Allow-Origin: *` が禁止なのはなぜですか？
- `Vary: Origin` を付けないと何が起きますか？
- `http://a.example:8080` と `http://a.example:9000` は same-site ですか？ same-origin ですか？
