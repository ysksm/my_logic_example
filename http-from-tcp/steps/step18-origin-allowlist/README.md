# step18: 許可リストと落とし穴

## step17からの差分

- Origin の許可リストを正しく実装する
- よくある実装ミス4種類を、動く形で並べて比較する

## 正しい実装

```js
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "https://app.example.com",
]);

function safeCors(origin) {
  const headers = { "Vary": "Origin" };              // 許可でも不許可でも必ず付ける
  if (!origin) return headers;                       // Origin無しはCORS対象外
  if (!ALLOWED_ORIGINS.has(origin)) return headers;  // ← 完全一致だけ

  headers["Access-Control-Allow-Origin"] = origin;   // "*" ではない
  headers["Access-Control-Allow-Credentials"] = "true";
  headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  headers["Access-Control-Max-Age"] = "600";
  return headers;
}
```

要点は **`Set.has()` による完全一致**です。前方一致でも部分一致でも正規表現でもありません。

## 起動

```sh
node server.js
```

ブラウザで `http://localhost:8080/` を開き、
**ターミナルでも curl を打てるようにしておいてください。**

## なぜ curl を使うのか

ブラウザからは `Origin` を偽装できません（JSから変更不可）。
攻撃者は自分のサイトから送るので、実際には偽装ではなく
「**悪意あるサイトの本物のOrigin**」が届きます。
これを手元で再現するのに curl を使います。

## 実験 — 4つの落とし穴

```sh
# (1) 正しい実装 → 何も返さない（＝ブラウザが読ませない）
curl -s -D- -o/dev/null -H 'Origin: http://evil.example' \
  http://localhost:8081/api/safe | grep -i access-control

# (2) Origin をそのまま返す → 誰でも通る
curl -s -D- -o/dev/null -H 'Origin: http://evil.example' \
  http://localhost:8081/api/reflect-any | grep -i access-control

# (3) 前方一致のバグ → localhost:8080.evil.example が通る
curl -s -D- -o/dev/null -H 'Origin: http://localhost:8080.evil.example' \
  http://localhost:8081/api/prefix-bug | grep -i access-control

# (4) 部分一致のバグ → notlocalhost:8080 が通る
curl -s -D- -o/dev/null -H 'Origin: http://notlocalhost:8080' \
  http://localhost:8081/api/includes-bug | grep -i access-control
```

結果:

| エンドポイント | 送ったOrigin | 返ったACAO |
|---|---|---|
| `/api/safe` | `http://evil.example` | **無し**（正しい） |
| `/api/reflect-any` | `http://evil.example` | `http://evil.example` |
| `/api/prefix-bug` | `http://localhost:8080.evil.example` | そのまま返る |
| `/api/includes-bug` | `http://notlocalhost:8080` | そのまま返る |

`localhost:8080.evil.example` も `notlocalhost:8080` も、
**攻撃者が自由に用意できるドメイン名**です。

## 落とし穴4: `Origin: null`

「sandbox iframe から2つのAPIを呼ぶ」ボタンを押してください。

`sandbox` 属性付き（`allow-same-origin` なし）の iframe は、
オリジンが「不透明」になり、そこから出るリクエストの `Origin` は
文字列 `null` になります。

- `/api/safe` … `null` は許可リストに無いので防げる
- `/api/null-origin` … `null` を許可しているので**読めてしまう**

`Origin: null` が発生する場面:

- `sandbox` 属性付きの iframe
- `file://` から開いたページ
- クロスオリジンのリダイレクトを経たリクエスト
- `data:` URL

**`null` は「オリジンが無い」ではなく「オリジンを隠したい文脈」です。
許可リストに入れてはいけません。**

## なぜ「Originをそのまま返す」が危険なのか

`Access-Control-Allow-Origin: <来たOrigin>` ＋ `Access-Control-Allow-Credentials: true` は、
実質的に「**全世界に対して、ログイン中のユーザーとしてAPIを叩き、結果を読む権利**」
を与えたのと同じです。

1. 利用者があなたのサービスにログインしている（Cookieを持っている）
2. 利用者が攻撃者のページを開く
3. そのページのJSが `fetch(あなたのAPI, {credentials:'include'})` を実行
4. ブラウザは利用者のCookieを付けて送る
5. APIは「来たOriginを許可」するので、攻撃者のJSが応答を**読める**

step12 で見た「CORSが守っているのは利用者」の裏返しです。
設定を間違えると、守るはずだった利用者を自分で危険にさらします。

## CORS についてよくある誤解

| 誤解 | 実際 |
|---|---|
| CORSはサーバを守るセキュリティ機能だ | 違います。守っているのは**利用者**です。サーバを守りたいなら認証・認可を実装してください |
| CORSを設定すれば不正なリクエストを弾ける | 弾けません。curl やサーバ間通信には**一切効きません**。効くのはブラウザの中のJSに対してだけです |
| CORSがあればCSRFも防げる | 防げません（下記） |
| `Access-Control-Allow-Origin: *` にすると危険 | 公開APIならむしろ正解です。危険なのは `*` ではなく**「Originの反射 ＋ credentials」**の組み合わせです |

### CORS と CSRF の違い

| | CORS | CSRF |
|---|---|---|
| 攻撃者がしたいこと | 応答を**読む** | リクエストを**送らせる** |
| 例 | 残高を盗み見る | 勝手に送金させる |
| 応答を読む必要 | ある | **ない** |
| 防ぐ仕組み | 同一オリジンポリシー + CORS | `SameSite` Cookie、CSRFトークン |

`<form method="POST" action="https://bank.example/transfer">` は
CORSに関係なく送信できます（step12 の実験4を思い出してください）。
攻撃者は応答を読めませんが、**送金はもう終わっています**。

**CORSはCSRF対策ではありません。**

## チェックリスト

- [ ] 許可リストは**完全一致**で照合しているか（前方一致・部分一致・雑な正規表現になっていないか）
- [ ] `Origin` をそのまま返していないか。返すなら許可リスト通過後だけか
- [ ] `null` を許可リストに入れていないか
- [ ] `Vary: Origin` を付けているか（許可・不許可どちらの場合も）
- [ ] credentials が不要なら `Access-Control-Allow-Credentials` を付けていないか
- [ ] `Allow-Methods` / `Allow-Headers` を必要最小限にしているか
- [ ] CORSとは**別に**認証・認可を実装しているか
- [ ] CSRF対策（`SameSite`、トークン）を別途しているか

## 第4章・第5章のまとめ

| ヘッダー | 誰が付ける | 役割 |
|---|---|---|
| `Origin` | ブラウザ | このリクエストはどのページから出たか |
| `Access-Control-Allow-Origin` | サーバ | このオリジンには応答を読ませてよい |
| `Access-Control-Request-Method` | ブラウザ（プリフライト） | これから使いたいメソッド |
| `Access-Control-Request-Headers` | ブラウザ（プリフライト） | これから付けたいヘッダー |
| `Access-Control-Allow-Methods` | サーバ（プリフライト応答） | 許可するメソッド |
| `Access-Control-Allow-Headers` | サーバ（プリフライト応答） | 許可するヘッダー |
| `Access-Control-Max-Age` | サーバ（プリフライト応答） | 許可の有効期間 |
| `Access-Control-Allow-Credentials` | サーバ | Cookieを伴ってよい |
| `Access-Control-Expose-Headers` | サーバ | JSに読ませてよいレスポンスヘッダー |
| `Vary: Origin` | サーバ | 応答はOriginによって変わる（キャッシュ向け） |

## 確認

- `origin.startsWith("https://app.example.com")` の何が問題ですか？
- `Origin: null` はどんなときに発生しますか？
- CORSを正しく設定すればCSRFは防げますか？
