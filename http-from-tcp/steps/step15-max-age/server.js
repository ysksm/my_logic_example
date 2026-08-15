// ============================================================
// step15: Access-Control-Max-Age（プリフライトのキャッシュ）
//
// step14 との差分:
//   - プリフライト応答に Access-Control-Max-Age を付ける
//   - OPTIONS が実際に何回来たかを数えて、目に見えるようにする
//
//   /api/nocache … Max-Age なし  → 毎回プリフライトが飛ぶ
//   /api/cached  … Max-Age: 30   → 30秒間は飛ばない
//
//   $ node server.js
//   → ブラウザで http://localhost:8080/ を開く
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

const ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOW_HEADERS = "Content-Type";

// OPTIONS と本番が何回来たかを数える
const count = {
  "/api/nocache": { preflight: 0, actual: 0 },
  "/api/cached": { preflight: 0, actual: 0 },
};

createHttpServer((req, res) => {
  const origin = req.headers["origin"];

  if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
    if (count[req.path]) count[req.path].preflight++;

    console.log(
      `${C.yellow}★ プリフライト${C.reset} OPTIONS ${req.path}` +
      `  （このパスへのOPTIONSは通算 ${count[req.path]?.preflight ?? "?"} 回目）`
    );

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": ALLOW_METHODS,
      "Access-Control-Allow-Headers": ALLOW_HEADERS,
    };

    // ここが今回の主役。
    // 「この許可は N 秒間有効です」とブラウザに伝えると、
    // ブラウザは同じ条件のプリフライトを N 秒間スキップする。
    if (req.path === "/api/cached") {
      headers["Access-Control-Max-Age"] = "30";
      console.log(`  → Access-Control-Max-Age: 30 を付けました`);
    } else {
      console.log(`  → Max-Age は付けません（毎回聞きに来ます）`);
    }

    return res.send(204, headers);
  }

  if (count[req.path]) count[req.path].actual++;

  console.log(
    `${C.bold}[API 8081] ${req.method} ${req.path}${C.reset}` +
    `  Origin: ${origin ?? "(無し)"}`
  );

  // 集計を返す（単純なGETなのでプリフライトは飛ばない）
  if (req.path === "/api/stats") {
    return res.json(200, count, { "Access-Control-Allow-Origin": "*" });
  }

  if (req.path === "/api/reset") {
    for (const k of Object.keys(count)) count[k] = { preflight: 0, actual: 0 };
    console.log(`${C.green}カウンタをリセットしました${C.reset}`);
    return res.json(200, count, { "Access-Control-Allow-Origin": "*" });
  }

  res.json(200, { ok: true, method: req.method, path: req.path },
    { "Access-Control-Allow-Origin": "*" });
}, "[API 8081]").listen(PORT_API);

createHttpServer((req, res) => {
  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[ページ 8080]").listen(PORT_PAGE, () => {
  console.log("============================================");
  console.log(" step15: Access-Control-Max-Age");
  console.log("============================================");
  console.log(` オリジンA（ページ）: http://localhost:${PORT_PAGE}`);
  console.log(` オリジンB（API）   : http://localhost:${PORT_API}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PAGE}/ を開いてください`);
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step15: Access-Control-Max-Age</title>
<style>
 body{font-family:sans-serif;max-width:52em;margin:2em auto;line-height:1.8;padding:0 1em}
 button{font-size:.95em;padding:.5em 1em;margin:.2em 0}
 .log{background:#111;color:#eee;padding:1em;border-radius:6px;white-space:pre-wrap;
      font-family:monospace;font-size:13px;min-height:6em}
 .ok{color:#4ade80} .ng{color:#f87171} .hint{color:#fbbf24}
 code{background:#eee;padding:1px 4px;border-radius:3px}
 table{border-collapse:collapse;width:100%;margin:1em 0}
 th,td{border:1px solid #ccc;padding:8px 12px;text-align:left} th{background:#f3f4f6}
 td.n{font-size:1.4em;font-weight:bold;text-align:center}
</style>
<body>
<h1>step15: <code>Access-Control-Max-Age</code></h1>

<p>どちらのボタンも「<code>PUT</code> を3回連続で送る」だけです。<br>
違いはサーバが <code>Access-Control-Max-Age</code> を返すかどうかだけ。</p>

<p>
<button onclick="burst('/api/nocache')">/api/nocache へ PUT×3（Max-Ageなし）</button>
<button onclick="burst('/api/cached')">/api/cached へ PUT×3（Max-Age: 30）</button>
<button onclick="reset()">カウンタをリセット</button>
</p>

<h2>サーバに届いた回数</h2>
<table id="stats">
<tr><th>パス</th><th>OPTIONS（プリフライト）</th><th>本番リクエスト</th></tr>
<tr><td><code>/api/nocache</code></td><td class="n" id="p-nocache">-</td><td class="n" id="a-nocache">-</td></tr>
<tr><td><code>/api/cached</code></td><td class="n" id="p-cached">-</td><td class="n" id="a-cached">-</td></tr>
</table>

<h2>結果</h2>
<div class="log" id="log">ボタンを押してください</div>

<h2>ポイント</h2>
<ul>
<li>プリフライトは<strong>往復1回分まるごと余計な通信</strong>です。
    APIを100回呼ぶと、キャッシュが無ければOPTIONSも100回飛びます。</li>
<li>キャッシュの単位は「オリジン＋URL＋メソッド＋ヘッダーの組み合わせ」です。
    <code>/api/cached</code> への <code>PUT</code> がキャッシュされていても、
    <code>DELETE</code> は別扱いで改めてプリフライトが飛びます。</li>
<li>上限があります。<strong>Chrome は最大 7200 秒（2時間）</strong>、
    Firefox は 86400 秒。これを超える値を返しても上限に丸められます。</li>
<li>開発中に大きな値を入れると、CORS設定を直しても
    ブラウザが古い許可を覚えていて混乱します。
    そのときは DevTools の Network タブで <strong>Disable cache</strong> を
    有効にするか、ブラウザを再起動してください。</li>
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

async function stats() {
  var r = await fetch(API + '/api/stats');
  var s = await r.json();
  document.getElementById('p-nocache').textContent = s['/api/nocache'].preflight;
  document.getElementById('a-nocache').textContent = s['/api/nocache'].actual;
  document.getElementById('p-cached').textContent = s['/api/cached'].preflight;
  document.getElementById('a-cached').textContent = s['/api/cached'].actual;
  return s;
}

async function burst(path) {
  clear();
  log('PUT ' + path + ' を3回続けて送ります…');
  for (var i = 1; i <= 3; i++) {
    try {
      var r = await fetch(API + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{"n":' + i + '}'
      });
      log('  ' + i + '回目: status=' + r.status, 'ok');
    } catch (e) {
      log('  ' + i + '回目: 失敗 ' + e, 'ng');
    }
  }
  var s = await stats();
  var c = s[path];
  log('');
  log('サーバに届いた回数: OPTIONS=' + c.preflight + ' / 本番=' + c.actual, 'hint');
  if (path === '/api/cached') {
    log('本番は3回なのに OPTIONS は1回だけ。', 'hint');
    log('2回目以降はブラウザが「30秒間は許可済み」と覚えているためです。', 'hint');
  } else {
    log('本番3回に対して OPTIONS も3回。毎回聞きに行っています。', 'hint');
  }
  log('');
  log('DevTools の Network タブでも OPTIONS の行数を数えてみてください。');
}

async function reset() {
  clear();
  await fetch(API + '/api/reset');
  await stats();
  log('カウンタをリセットしました。', 'ok');
  log('※ ブラウザ側のプリフライトキャッシュは消えません（30秒待つか再起動を）', 'hint');
}

stats();
</script>
</body></html>
`;
