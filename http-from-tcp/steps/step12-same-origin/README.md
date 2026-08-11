# step12: 同一オリジンポリシー

第4章のはじまり。ここからは**2つのサーバを1プロセスで動かします**。

```
オリジンA  http://localhost:8080  … 実験ページを配る（ブラウザが表示する側）
オリジンB  http://localhost:8081  … API（別オリジン）
```

## step11からの差分

- HTTPコアに「どちらのサーバのログか」を示す `label` を足しただけ
- APIは **CORSヘッダーを一切返さない**（これが今回の主役）

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開いてください。
**必ずサーバのコンソールも見えるようにしておいてください。**

## オリジンとは

```
http://localhost:8080
└─┬─┘  └───┬───┘ └┬─┘
スキーム  ホスト   ポート
```

**この3つがすべて一致するときだけ「同一オリジン」**です。

| 比較対象（基準: `http://localhost:8080`） | 判定 | 理由 |
|---|---|---|
| `http://localhost:8080/other/path` | 同一 | パスは関係ない |
| `http://localhost:8081` | **別** | ポートが違う |
| `https://localhost:8080` | **別** | スキームが違う |
| `http://127.0.0.1:8080` | **別** | ホスト名が違う（同じマシンでも） |
| `http://sub.localhost:8080` | **別** | ホスト名が違う |

## 実験1 — 同一オリジン

「① GET /api/same-origin」を押すと成功します。8080 自身が返しているからです。

## 実験2 — 別オリジン（このステップの核心）

「② GET http://localhost:8081/api/hello」を押すと**失敗**します。

**そのあと必ずサーバのコンソールを見てください。**

```
[API 8081] GET /api/hello  Origin: http://localhost:8080
```

**リクエストは届いています。200 OK も返しています。**

つまり:

- サーバは何も拒否していない
- 通信は完全に成功している
- それでも JavaScript は中身を読めない

**CORSはサーバの機能ではなく、ブラウザの機能です。**
「サーバがブラウザに、読ませてよいと伝える仕組み」がCORSです。

DevTools の Console を見ると、こう書かれています。

```
Access to fetch at 'http://localhost:8081/api/hello' from origin
'http://localhost:8080' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

「**has been blocked by CORS policy**」— 誰にブロックされたのか。ブラウザにです。

## 実験3 — curlなら成功する

```sh
curl -s http://localhost:8081/api/hello
```

普通に読めます。

**わかること:** curl にも、サーバ間通信にも、CORSは**一切効きません**。
CORSはアクセス制御ではありません。

## 実験4 — `<img>` なら別オリジンでも読める

「③ &lt;img src="http://localhost:8081/api/pixel"&gt;」を押すと**成功**します。

`<img>` `<script>` `<link>` `<form>` `<iframe>` は、CORSが生まれるずっと前から
他オリジンを読み込めていました。今もそのままです。

**同一オリジンポリシーが止めているのは「送ること」ではなく、
「JavaScriptがレスポンスの中身を読むこと」です。**

- `<img>` で他オリジンの画像を表示する → できる
- その画像を `<canvas>` に描いて `getImageData()` で中身を読む → **そこで止められる**
- `<script src>` で他オリジンのJSを実行する → できる
- `<form>` で他オリジンにPOSTする → **できる**（← CSRFが成立する理由）

## 何のための仕組みなのか

あなたが銀行にログインしているとします。攻撃者のページを開いたとき、
そのページのJSがこう書けたらどうなるでしょう。

```js
const r = await fetch('https://bank.example/api/balance', { credentials: 'include' });
const data = await r.json();     // 残高が読めてしまう
sendToAttacker(data);
```

ブラウザはあなたのCookieを自動で付けます。だから**リクエストは通ってしまう**。
これを防ぐため、ブラウザは「**別オリジンの応答をJSに渡さない**」という規則を持っています。

**CORSが守っているのはサーバではなく、利用者（あなた）です。**

そのうえで「このオリジンになら読ませてよい」とサーバが宣言する手段が、
次のステップの `Access-Control-Allow-Origin` です。

## 確認

- `http://example.com` と `https://example.com` は同一オリジンですか？
- fetch が失敗したとき、サーバにリクエストは届いていましたか？
- `<form>` で他オリジンにPOSTするのはCORSで止められますか？
