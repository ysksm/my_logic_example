// ============================================================
// step18: 許可リストと落とし穴
//
// step17 との差分:
//   - Origin の許可リストを正しく実装する
//   - よくある実装ミスを4種類、動く形で並べて比較する
//
//   $ node server.js
//   → ブラウザで http://localhost:8080/ を開く
//   → さらに curl でOriginを偽装して確かめる（READMEを参照）
// ============================================================

import net from "node:net";

// ────────────────────────────────────────────────────────────
// ここから ▼ HTTPコア（step05のものに「どちらのサーバか」のラベルだけ足したもの）
// ────────────────────────────────────────────────────────────

const C = { gray: "\x1b[90m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", bold: "\x1b[1m", reset: "\x1b[0m" };

const REASON = {
  200: "OK", 201: "Created", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
  404: "Not Found", 405: "Method Not Allowed", 415: "Unsupported Media Type",
  500: "Internal Server Error",
};

function visualize(buf) {
  return buf
    .toString("utf8")
    .replace(/\r/g, C.gray + "\\r" + C.reset)
    .replace(/\n/g, C.gray + "\\n" + C.reset + "\n");
}

function dump(label, color, buf) {
  console.log(`\n${color}──── ${label} (${buf.length} バイト) ────────────────${C.reset}`);
  process.stdout.write(visualize(buf));
  console.log(`${color}────────────────────────────────────────${C.reset}`);
}

/**
 * handler(req, res) を呼ぶだけのHTTPサーバを作る。
 * label は「どちらのサーバのログか」を見分ける目印（第4章で追加）。
 *   req = { method, target, path, query, version, headers, body, raw }
 *   res = { send, text, html, json }
 */
function createHttpServer(handler, label = "") {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let closed = false;
    let reqCount = 0;

    socket.on("close", () => { closed = true; });
    socket.on("error", (err) => console.log(`  接続エラー: ${err.message}`));

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // 1本の接続に「リクエスト → 応答 → リクエスト → 応答」と
      // 続けて流れてくるのが keep-alive。だから while で回す。
      while (!closed) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break; // ヘッダーがまだ揃っていない

        const headText = buffer.subarray(0, headerEnd).toString("utf8");
        const lines = headText.split("\r\n");
        const [method, target, version] = lines[0].split(" ");

        const headers = {};
        for (const line of lines.slice(1)) {
          const colon = line.indexOf(":");
          if (colon === -1) continue;
          const name = line.slice(0, colon).trim().toLowerCase();
          const value = line.slice(colon + 1).trim();
          headers[name] = name in headers ? headers[name] + ", " + value : value;
        }

        const bodyStart = headerEnd + 4;
        const contentLength = Number(headers["content-length"] ?? 0);
        if (buffer.length < bodyStart + contentLength) break; // ボディがまだ

        const body = buffer.subarray(bodyStart, bodyStart + contentLength);
        const raw = buffer.subarray(0, bodyStart + contentLength);

        // 読み切った分をバッファから捨てる。残りは次のリクエスト。
        buffer = buffer.subarray(bodyStart + contentLength);
        reqCount++;

        dump(`▼ 受信 ${label} [この接続の ${reqCount} 本目]`, C.cyan, raw);

        // パスとクエリを分ける
        const qIndex = (target ?? "/").indexOf("?");
        const path = qIndex === -1 ? target : target.slice(0, qIndex);
        const query = qIndex === -1 ? "" : target.slice(qIndex + 1);

        const req = { method, target, path, query, version, headers, body, raw };
        const res = makeResponse(socket, req, label);

        try {
          handler(req, res);
        } catch (err) {
          console.log(`${C.red}ハンドラで例外: ${err.stack}${C.reset}`);
          if (!res.sent) res.text(500, "Internal Server Error\n");
        }
      }
    });
  });
}

function makeResponse(socket, req, label = "") {
  // HTTP/1.1 は既定で keep-alive。閉じたいときだけ Connection: close と言う。
  const keepAlive = (req.headers["connection"] ?? "").toLowerCase() !== "close";

  const res = {
    sent: false,

    /** status, ヘッダー辞書, ボディ を組み立てて送る */
    send(status, headers = {}, body = "") {
      if (res.sent) return;
      res.sent = true;

      const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""), "utf8");
      const noBody = status === 204 || status === 304;

      const out = { ...headers };
      // 204/304 はボディを持てないので Content-Length も付けない
      if (!noBody) out["Content-Length"] = String(bodyBuf.length);
      out["Connection"] = keepAlive ? "keep-alive" : "close";

      const lines = [`HTTP/1.1 ${status} ${REASON[status] ?? ""}`.trim()];
      for (const [name, value] of Object.entries(out)) {
        if (value === undefined || value === null) continue;
        // 配列を渡すと同じ名前の行を複数出す（Set-Cookie 用。step10で使う）
        for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
      }

      const head = Buffer.from(lines.join("\r\n") + "\r\n\r\n", "utf8");
      const packet = noBody ? head : Buffer.concat([head, bodyBuf]);

      dump(`▲ 送信 ${label}`, C.green, packet);
      socket.write(packet);
      if (!keepAlive) socket.end();
    },

    text: (status, s, extra = {}) =>
      res.send(status, { "Content-Type": "text/plain; charset=utf-8", ...extra }, s),

    html: (status, s, extra = {}) =>
      res.send(status, { "Content-Type": "text/html; charset=utf-8", ...extra }, s),

    json: (status, obj, extra = {}) =>
      res.send(status, { "Content-Type": "application/json; charset=utf-8", ...extra },
        JSON.stringify(obj, null, 2) + "\n"),
  };

  return res;
}

// ────────────────────────────────────────────────────────────
// ここまで ▲ HTTPコア

// ────────────────────────────────────────────────────────────
// ▼▼▼ このステップの新しい部分 ▼▼▼
// ────────────────────────────────────────────────────────────

const PORT_PAGE = 8080;
const PORT_API = 8081;

// ── これが正解の形 ────────────────────────────────────────
// 完全一致で照合する集合。前方一致でも部分一致でも正規表現でもない。
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "https://app.example.com",
]);

function safeCors(origin) {
  // Vary: Origin は、許可・不許可どちらの場合も必ず付ける。
  // 「この応答は Origin によって内容が変わる」とキャッシュに伝えるため。
  const headers = { "Vary": "Origin" };

  if (!origin) return headers;                    // Origin無し（curl等）はCORS対象外
  if (!ALLOWED_ORIGINS.has(origin)) return headers; // 一致しなければ何も付けない

  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Credentials"] = "true";
  headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  headers["Access-Control-Max-Age"] = "600";
  return headers;
}

// ── ここから下は「やってはいけない実装」の見本 ──────────────
const BAD = {
  // 落とし穴1: 来たOriginをそのまま返す
  "reflect-any": (origin) => ({
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  }),

  // 落とし穴2: 前方一致
  //   "http://localhost:8080.evil.example" が通ってしまう
  "prefix-bug": (origin) =>
    origin && origin.startsWith("http://localhost:8080")
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" }
      : { "Vary": "Origin" },

  // 落とし穴3: 部分一致
  //   "http://notlocalhost:8080" が通ってしまう
  "includes-bug": (origin) =>
    origin && origin.includes("localhost:8080")
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" }
      : { "Vary": "Origin" },

  // 落とし穴4: null を許可リストに入れている
  //   sandbox属性付きiframeやリダイレクト後のリクエストは Origin: null になる
  "null-origin": (origin) =>
    origin === "null" || (origin && ALLOWED_ORIGINS.has(origin))
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" }
      : { "Vary": "Origin" },
};

createHttpServer((req, res) => {
  const origin = req.headers["origin"];
  const kind = req.path.replace(/^\/api\//, "");

  const cors = kind in BAD ? BAD[kind](origin) : safeCors(origin);
  const allowed = Boolean(cors["Access-Control-Allow-Origin"]);

  console.log(
    `${C.bold}[API 8081] ${req.method} ${req.path}${C.reset}` +
    `  Origin: ${origin ?? "(無し)"}` +
    `  → ${allowed ? C.green + "許可 (" + cors["Access-Control-Allow-Origin"] + ")" + C.reset
                   : C.red + "許可しない" + C.reset}`
  );

  if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
    return res.send(204, cors);
  }

  res.json(200, {
    endpoint: req.path,
    あなたのOrigin: origin ?? "(無し)",
    このAPIが返したACAO: cors["Access-Control-Allow-Origin"] ?? "(付けていない)",
    秘密のデータ: "本来ログイン中のユーザーにしか見せてはいけない情報",
  }, cors);
}, "[API 8081]").listen(PORT_API);

createHttpServer((req, res) => {
  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[ページ 8080]").listen(PORT_PAGE, () => {
  console.log("============================================");
  console.log(" step18: 許可リストと落とし穴");
  console.log("============================================");
  console.log(` オリジンA（ページ）: http://localhost:${PORT_PAGE}`);
  console.log(` オリジンB（API）   : http://localhost:${PORT_API}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PAGE}/ を開いてください`);
  console.log("");
  console.log(" curl で悪意あるOriginを偽装してみましょう:");
  console.log("   curl -s -D- -o/dev/null -H 'Origin: http://evil.example' \\");
  console.log("     http://localhost:8081/api/safe | grep -i access-control");
  console.log("   curl -s -D- -o/dev/null -H 'Origin: http://evil.example' \\");
  console.log("     http://localhost:8081/api/reflect-any | grep -i access-control");
  console.log("   curl -s -D- -o/dev/null -H 'Origin: http://localhost:8080.evil.example' \\");
  console.log("     http://localhost:8081/api/prefix-bug | grep -i access-control");
  console.log("   curl -s -D- -o/dev/null -H 'Origin: http://notlocalhost:8080' \\");
  console.log("     http://localhost:8081/api/includes-bug | grep -i access-control");
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step18: 許可リストと落とし穴</title>
<style>
 body{font-family:sans-serif;max-width:54em;margin:2em auto;line-height:1.8;padding:0 1em}
 button{font-size:.95em;padding:.5em 1em;margin:.2em 0;display:block;width:100%;text-align:left}
 .log{background:#111;color:#eee;padding:1em;border-radius:6px;white-space:pre-wrap;
      font-family:monospace;font-size:13px;min-height:6em}
 .ok{color:#4ade80} .ng{color:#f87171} .hint{color:#fbbf24}
 code{background:#eee;padding:1px 4px;border-radius:3px}
 pre{background:#f6f8fa;padding:1em;border-radius:6px;overflow-x:auto;font-size:13px}
 table{border-collapse:collapse;width:100%;margin:1em 0}
 th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;vertical-align:top} th{background:#f3f4f6}
 .danger{background:#fef2f2;border-left:4px solid #dc2626;padding:1em 1.2em;border-radius:4px}
</style>
<body>
<h1>step18: 許可リストと落とし穴</h1>

<h2>正しい実装</h2>
<pre>const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "https://app.example.com",
]);

function safeCors(origin) {
  const headers = { "Vary": "Origin" };          // 許可でも不許可でも必ず付ける
  if (!origin) return headers;                   // Origin無しはCORS対象外
  if (!ALLOWED_ORIGINS.has(origin)) return headers;  // ← 完全一致だけ

  headers["Access-Control-Allow-Origin"] = origin;   // "*" ではない
  headers["Access-Control-Allow-Credentials"] = "true";
  headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  headers["Access-Control-Max-Age"] = "600";
  return headers;
}</pre>

<button onclick="call('/api/safe')">GET /api/safe（このページからは許可される）</button>

<h2>落とし穴の実演には curl を使います</h2>
<p>ブラウザは <code>Origin</code> を偽装できません（JSからは変更不可）。
攻撃者は自分のサイトから送るので、実際には偽装ではなく
「悪意あるサイトの本物のOrigin」が届きます。
これをターミナルで再現します。</p>

<pre>#(1) 正しい実装 → 何も返さない（＝ブラウザが読ませない）
curl -s -D- -o/dev/null -H 'Origin: http://evil.example' \\
  http://localhost:8081/api/safe | grep -i access-control

#(2) Origin をそのまま返す → 誰でも通る
curl -s -D- -o/dev/null -H 'Origin: http://evil.example' \\
  http://localhost:8081/api/reflect-any | grep -i access-control

#(3) 前方一致のバグ → localhost:8080.evil.example が通る
curl -s -D- -o/dev/null -H 'Origin: http://localhost:8080.evil.example' \\
  http://localhost:8081/api/prefix-bug | grep -i access-control

#(4) 部分一致のバグ → notlocalhost:8080 が通る
curl -s -D- -o/dev/null -H 'Origin: http://notlocalhost:8080' \\
  http://localhost:8081/api/includes-bug | grep -i access-control</pre>

<h2>落とし穴4: <code>Origin: null</code></h2>
<p>下のボタンは <code>sandbox</code> 属性付きの iframe を作ります。
sandbox された文書のオリジンは「不透明」になり、
そこから出るリクエストの <code>Origin</code> は文字列 <code>null</code> になります。</p>
<button onclick="nullOrigin()">sandbox iframe から2つのAPIを呼ぶ</button>
<div id="frames"></div>

<h2>結果</h2>
<div class="log" id="log">ボタンを押してください</div>

<h2 style="margin-top:2.5em">なぜ「Originをそのまま返す」が危険なのか</h2>
<div class="danger">
<p><code>Access-Control-Allow-Origin: &lt;来たOrigin&gt;</code> ＋
<code>Access-Control-Allow-Credentials: true</code> の組み合わせは、
実質的に<strong>「全世界に対して、ログイン中のユーザーとしてAPIを叩き、結果を読む権利」</strong>
を与えたのと同じです。</p>
<ol style="margin-bottom:0">
<li>利用者があなたのサービスにログインしている（Cookieを持っている）</li>
<li>利用者が攻撃者のページを開く</li>
<li>そのページの JS が <code>fetch(あなたのAPI, {credentials:'include'})</code> を実行</li>
<li>ブラウザは利用者のCookieを付けて送る</li>
<li>APIは「来たOriginを許可」するので、攻撃者のJSが応答を<strong>読める</strong></li>
</ol>
</div>

<h2>CORS についてよくある誤解</h2>
<table>
<tr><th>誤解</th><th>実際</th></tr>
<tr><td>CORSはサーバを守るセキュリティ機能だ</td>
    <td>違います。守っているのは<strong>利用者</strong>です。
        「他サイトのJSに、あなたの権限で得た応答を読ませない」仕組みです。
        サーバを守りたいなら認証・認可を実装してください</td></tr>
<tr><td>CORSを設定すれば不正なリクエストを弾ける</td>
    <td>弾けません。curl やサーバ間通信には<strong>一切効きません</strong>。
        効くのはブラウザの中のJSに対してだけです</td></tr>
<tr><td>CORSがあればCSRFも防げる</td>
    <td>防げません。CSRFは「送られること」自体が問題で、
        応答を読む必要がありません。単純リクエスト（フォーム送信など）は
        CORSに関係なく届きます。対策は <code>SameSite</code> Cookie と
        CSRFトークンです</td></tr>
<tr><td><code>Access-Control-Allow-Origin: *</code> にしておけば安全</td>
    <td>公開APIならむしろ正解です。危険なのは
        <code>*</code> ではなく<strong>「Originの反射 ＋ credentials」</strong>の組み合わせです</td></tr>
</table>

<h2>チェックリスト</h2>
<ul>
<li>許可リストは<strong>完全一致</strong>で照合しているか（前方一致・部分一致・雑な正規表現になっていないか）</li>
<li><code>Origin</code> をそのまま返していないか。返すなら許可リスト通過後だけか</li>
<li><code>null</code> を許可リストに入れていないか</li>
<li><code>Vary: Origin</code> を付けているか（キャッシュ汚染対策）</li>
<li>credentials が必要ないなら <code>Access-Control-Allow-Credentials</code> を付けていないか</li>
<li><code>Access-Control-Allow-Methods</code> / <code>-Headers</code> を必要最小限にしているか</li>
<li>CORSとは別に<strong>認証・認可</strong>を実装しているか</li>
</ul>

<script>
var API = 'http://localhost:8081';
var logEl = document.getElementById('log');
function log(msg, cls) {
  var s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = msg + '\\n';
  logEl.appendChild(s);
}
function clear() { logEl.textContent = ''; }

async function call(path) {
  clear();
  log('GET ' + API + path + '  (Origin: ' + location.origin + ')');
  try {
    var r = await fetch(API + path, { credentials: 'include' });
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
    log('');
    log('このページのオリジンは許可リストに載っているので読めます。', 'hint');
    log('上の curl を実行して、evil.example では読めないことを確かめてください。', 'hint');
  } catch (e) { log('失敗: ' + e, 'ng'); }
}

window.addEventListener('message', function (ev) {
  var d = ev.data;
  if (!d || !d.ep) return;
  if (d.ok) {
    log('  [' + d.ep + '] 読めた: ' + d.text, 'ng');
  } else {
    log('  [' + d.ep + '] 読めなかった: ' + d.text, 'ok');
  }
});

function nullOrigin() {
  clear();
  log('sandbox 付き iframe を作り、その中から fetch します。');
  log('この iframe のオリジンは不透明になり、Origin: null が送られます。');
  log('');
  log('（緑＝防げている / 赤＝通ってしまっている）');
  log('');

  var frames = document.getElementById('frames');
  frames.innerHTML = '';

  var inner =
    '<script>' +
    'function go(ep){' +
    '  fetch("' + API + '/api/"+ep,{credentials:"include"})' +
    '   .then(function(r){return r.text()})' +
    '   .then(function(t){parent.postMessage({ep:ep,ok:true,text:t.slice(0,120).replace(/\\\\s+/g," ")},"*")})' +
    '   .catch(function(e){parent.postMessage({ep:ep,ok:false,text:String(e)},"*")});' +
    '}' +
    'go("safe"); go("null-origin");' +
    '<\\/script>';

  var f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts'); // allow-same-origin を付けない＝不透明なオリジン
  f.style.display = 'none';
  f.srcdoc = inner;
  frames.appendChild(f);

  setTimeout(function () {
    log('');
    log('/api/safe は null を許可リストに入れていないので防げています。', 'hint');
    log('/api/null-origin は null を許可しているので読めてしまいました。', 'hint');
    log('サーバのコンソールで Origin: null を確認してください。', 'hint');
  }, 800);
}
</script>
</body></html>
`;
