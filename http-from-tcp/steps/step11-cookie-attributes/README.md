# step11: Cookie 属性とセッション

## step10からの差分

**HTTPコアは変更ありません。**

- `Set-Cookie` の属性 `Path` / `Max-Age` / `HttpOnly` / `Secure` / `SameSite`
- セッションID方式のログイン

## 属性の一覧

```
Set-Cookie: sid=abc123; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax
            └───┬───┘  └────────────────────┬───────────────────────────┘
             名前=値                       属性（; 区切り）
```

| 属性 | 意味 | 付けないと |
|---|---|---|
| `Path=/foo` | そのパス以下にだけ送る | サイト全体に送られる |
| `Domain=example.com` | サブドメインにも送る | そのホストにだけ送られる（より安全） |
| `Max-Age=3600` | 3600秒で消える | ブラウザを閉じると消える（セッションCookie） |
| `Expires=<日時>` | その日時に消える | 同上（`Max-Age` が優先される） |
| `HttpOnly` | JavaScriptから読めない | `document.cookie` で読める＝XSSで盗まれる |
| `Secure` | HTTPSのときだけ送る | httpでも送られる＝盗聴される |
| `SameSite=Lax\|Strict\|None` | 他サイト起点のリクエストに付けるか | ブラウザ既定は `Lax` |

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開いてください（このステップはブラウザ必須です）。

## 実験1 — HttpOnly

「属性つきCookieを5個受け取る」ボタンを押してください。ページに2つの表示が並びます。

- **サーバが受け取った Cookie**: `plain` `secret` `temp` `onlyhttps` が並ぶ
- **document.cookie**: `secret` が**無い**

ログインすると `sid` も同様に、サーバには届くが `document.cookie` には出ません。

**わかること:** `HttpOnly` は「JavaScriptから隠す」だけの属性です。通信には普通に載ります。
XSS（悪意あるJSの実行）が起きても、セッションIDだけは盗まれないようにするための防御です。

**セッションIDには必ず `HttpOnly` を付けてください。**

## 実験2 — Path

`/` と `/admin` を行き来してください。

| URL | `area` が表に出るか |
|---|---|
| `/` | 出ない |
| `/admin` | 出る |

`area=admin-only; Path=/admin` としているためです。

**わかること:** ブラウザは「送る先のパス」を見てCookieを選別しています。
不要なパスにCookieを送らないのは、リクエストサイズの節約にも情報漏洩の抑制にもなります。

## 実験3 — Max-Age

`temp=gone-in-10s; Path=/; Max-Age=10` を受け取ってから10秒待ってリロードしてください。
`temp` が消えています。

**わかること:** 有効期限もブラウザが管理します。サーバは何もしません。

## 実験4 — Secure と localhost の例外（重要）

`onlyhttps=secure-attr; Path=/; Secure` は **http なのに保存されています。**

これは仕様どおりです。ブラウザは `localhost` と `127.0.0.1` を
**「潜在的に信頼できるオリジン（potentially trustworthy origin）」** として扱い、
httpでも安全なオリジンとみなします。

本物のドメインを http で使った場合、`Secure` 付きCookieは保存されません。

> この例外は step16 で効いてきます。
> クロスオリジンでCookieを送るには `SameSite=None; Secure` が必要ですが、
> localhost なら https を用意しなくても実験できます。

## 実験5 — SameSite（step16の予告）

このステップではまだ体験できませんが、値の意味を押さえておいてください。

| 値 | 他サイトからのリクエストにCookieを付けるか |
|---|---|
| `Strict` | 一切付けない（他サイトのリンクから来ると未ログイン扱い） |
| `Lax`（既定） | トップレベルのGET遷移（リンククリック）だけ付ける |
| `None` | 常に付ける。ただし `Secure` が必須 |

`Lax` が既定になったのは **CSRF（クロスサイトリクエストフォージェリ）** 対策です。
他サイトに置かれた `<form method="POST" action="https://bank.example/transfer">` が
自動送信されても、Cookieが付かなければ認証が通りません。

**CORSとCSRFは別物です。** step18 で改めて整理します。

## セッションID方式

ログインすると、サーバはこうします。

```js
const sid = randomUUID();                       // 推測できないID
sessions.set(sid, { user, loginAt });           // 中身はサーバが持つ
"Set-Cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`
```

**Cookieに入れるのは「鍵」だけ**で、中身はサーバ側に置きます。

step10 の実験4で見たとおり、Cookieの値はクライアントが自由に書き換えられます。
`Cookie: user=admin` のように**中身そのもの**を入れると、書き換えられて終わりです。
推測できないIDだけを渡し、対応表はサーバが持つ。これがセッション方式の要点です。

ログアウト時は**サーバ側の `sessions` からも消す**ことを忘れないでください。
Cookieを消しただけでは、盗まれたIDがまだ有効なままです。

## 第3章のまとめ

- Cookieを保持するのはブラウザ。サーバはヘッダーで指示を出すだけ
- `Set-Cookie` は1つにつき1行、`Cookie` は全部まとめて1行
- 値はクライアントが書き換えられる → 推測不能なセッションIDを使う
- セッションIDには `HttpOnly` と（本番では）`Secure` を必ず付ける
- `SameSite` は他サイト起点のリクエストへの付与を制御する ← **第4章の重要な前提**

## 確認

- `HttpOnly` を付けると防げるのは何ですか？ 通信は暗号化されますか？
- `Secure` 付きCookieが `http://localhost` で保存されるのはなぜですか？
- セッションIDをCookieに入れ、ユーザー名そのものを入れないのはなぜですか？
