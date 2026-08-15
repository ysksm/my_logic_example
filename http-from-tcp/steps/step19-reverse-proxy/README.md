# step19（特別演習）: 同一オリジン化リバースプロキシ

CORSを「設定する」のではなく「**発生させない**」もうひとつの解です。

```
ブラウザ ──→ http://localhost:8080   ページ＋プロキシ（＝唯一のオリジン）
                    │  /api/* だけを転送
                    ↓
              http://127.0.0.1:9001   バックエンドAPI（CORS設定は一切なし）
```

ブラウザから見えるオリジンは 8080 ひとつだけ。
だから同一オリジンポリシーの対象にならず、**CORSは最初から発生しません**。

## このステップの技術的な新しさ

**サーバが初めて「TCPクライアント」になります。**

```js
const upstream = net.createConnection({ host, port }, () => {
  upstream.write(upstreamRequest);   // step02〜05 で組み立てたのと同じ形のテキスト
});
```

`net.createServer` の逆が `net.createConnection` です。
書き込むのは、step02 で手書きしたのと同じ `メソッド パス HTTP/1.1\r\n...` というテキスト。
第1章でやったことがそのまま使えます。

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開いてください。

1リクエストにつき**4つのダンプ**が出ます。

```
▼ ブラウザ    → プロキシ
▶ プロキシ    → バックエンド    ← Host が書き換わっている
◀ バックエンド → プロキシ
▲ プロキシ    → ブラウザ
```

## 実験1 — 直接 vs プロキシ経由

| ボタン | 呼び先 | 結果 |
|---|---|---|
| ① | `http://localhost:9001/api/hello`（直接） | **失敗** |
| ② | `/api/hello`（プロキシ経由） | **成功** |

**バックエンドは同じです。CORSヘッダーを1つも返していません。**
違うのは「ブラウザから見て何オリジンか」だけです。

② の fetch は相対パス `'/api/hello'` です。同一オリジンなので、
そもそもCORSの検査対象になりません。

## 実験2 — プリフライトが飛ばない

| ボタン | リクエスト |
|---|---|
| ③ | `PUT /api/items/1` + `Content-Type: application/json` |
| ④ | `DELETE /api/items/1` |

step14 なら**確実にプリフライトが飛んだ**組み合わせです。

サーバのコンソールに **`OPTIONS` が1つも出ない**ことを確認してください。
同一オリジンだからです。往復が1回減ります。

## 実験3 — Cookieが素直に動く

| ボタン | |
|---|---|
| ⑤ | `POST /api/login` |
| ⑥ | `GET /api/me` → `ログイン中: true` |

**`credentials: 'include'` を一度も書いていません。**
同一オリジンなので既定（`same-origin`）でCookieが送られます。

バックエンドが発行したCookieの属性も、ごく普通です。

```
Set-Cookie: sid=...; Path=/; HttpOnly; SameSite=Lax
```

`SameSite=None` も `Secure` も要りません。

DevTools → Application → Cookies を見ると、Cookieは
**`http://localhost:8080` のもの**として保存されています。
バックエンドが発行したのに、です。
ブラウザから見れば 8080 が返したのですから、当然そうなります。

## 2つの解の比較

| | CORSを設定する（step13〜18） | プロキシで同一オリジンにする（step19） |
|---|---|---|
| ブラウザから見たオリジン | 2つ | 1つ |
| プリフライト | 条件次第で飛ぶ（往復1回分の遅延） | 飛ばない |
| Cookie | `SameSite=None; Secure` ＋ `credentials:'include'` ＋ `Allow-Credentials` が必要 | ファーストパーティCookieとして普通に動く |
| APIの改修 | 必要（CORSヘッダーを返す） | 不要 |
| 運用 | サーバは1つでよい | プロキシ層が増える。障害点も増える |
| 通信量 | ブラウザ→API 直通 | すべてプロキシを経由する |
| 向いている場面 | 不特定多数に公開するAPI、別会社のフロントから叩かれるAPI | 自社フロント＋自社API、APIを改修できない場合 |

**どちらが正しいということはありません。** 状況で選びます。

実務で見かけるものは、ほぼすべてこの2つのどちらかです。

- Vite の `server.proxy` / Next.js の `rewrites` → step19 の方式
- Nginx の `location /api/ { proxy_pass ...; }` → step19 の方式
- Kubernetes Ingress のパスベースルーティング → step19 の方式
- 公開REST API の `Access-Control-Allow-Origin: *` → step13 の方式

## コードの要点

### 1. ホップバイホップヘッダーを転送しない

```js
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);
```

これらは「**この1本の接続についての取り決め**」です。
次の接続にそのまま持ち越すと壊れます。

たとえばブラウザが `Connection: keep-alive` と言ってきたからといって、
プロキシ→バックエンドの接続もそうすべきとは限りません。

### 2. `Host` を書き換え、元の情報は `X-Forwarded-*` で渡す

```js
outHeaders.push(`Host: ${BACKEND_HOST}:${BACKEND_PORT}`);
outHeaders.push(`X-Forwarded-Host: ${req.headers["host"]}`);
outHeaders.push(`X-Forwarded-Proto: http`);
outHeaders.push(`X-Forwarded-For: 127.0.0.1`);
```

バックエンドは「自分は何というホスト名で呼ばれたのか」を知りたいことがあります
（リダイレクト先URLの生成など）。`Host` は書き換えてしまうので、
元の情報は `X-Forwarded-*` で渡すのが慣習です。

### 3. 同名ヘッダーを潰さない

```js
if (headers.has(key)) headers.get(key).values.push(value);
```

`Set-Cookie` が2行あるとき、片方を捨ててしまうとログインが壊れます。
step10 でやった「`Set-Cookie` は連結してはいけない」がここで効きます。

### 4. `Content-Length` は自分で計算し直す

ボディを触らなくても、ヘッダーを組み替えている以上、
元の値をそのまま使うと事故のもとです。

## プロキシを書くときの注意

- **転送先を固定する。** URLの一部を転送先ホストにするような作りにすると、
  社内ネットワークへの踏み台（**SSRF**）になります
- クライアントが送ってきた `X-Forwarded-For` を**信用しない**（偽装できます）。
  自分で上書きするか、信頼できる範囲だけ追記します
- この実装は `Transfer-Encoding: chunked`、WebSocket（`Upgrade`）、
  ストリーミングに対応していません。学習用の単純化です
- バックエンドへ `Connection: close` を送っているので、毎回TCP接続を張り直しています。
  実務のプロキシは接続プールを持ちます

## 確認

- なぜプロキシ経由だとプリフライトが飛ばないのですか？
- バックエンドのCookieが `localhost:8080` のCookieとして保存されるのはなぜですか？
- `Connection` ヘッダーを転送してはいけないのはなぜですか？
- 転送先ホストをURLから決める作りにすると、何が起きますか？

## おつかれさまでした

第1章の「TCPはただの土管」から始めて、
HTTPを組み立て、4つのメソッドを実装し、Cookieで状態を持たせ、
CORSの各ヘッダーを1つずつ動かして確かめ、
最後にプロキシでオリジンそのものを畳みました。

CORSのエラーメッセージを見たとき、これからは
「ブラウザが、どの段階で、どの条件を満たさなかったのか」
を具体的に切り分けられるはずです。
