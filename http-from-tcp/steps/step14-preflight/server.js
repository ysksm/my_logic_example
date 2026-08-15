// ============================================================
// step14: プリフライト
//
// step13 との差分:
//   - APIが OPTIONS（プリフライト）に応答するようになる
//   - Access-Control-Request-Method / -Headers を読んで
//     Access-Control-Allow-Methods / -Headers で答える
//
// 比較用に3種類のエンドポイントを用意しています。
//   /api/ok             … プリフライトにも本番にも正しく応答する
//   /api/strict         … プリフライトに応答しない（step13と同じ状態）
//   /api/preflight-only … プリフライトは通るが、本番応答にACAOが無い
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

// このAPIが受け入れるメソッドとヘッダー
const ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOW_HEADERS = "Content-Type, X-Demo";

createHttpServer((req, res) => {
  const origin = req.headers["origin"];

  console.log(
    `${C.bold}[API 8081] ${req.method} ${req.path}${C.reset}` +
    `  Origin: ${origin ? C.yellow + origin + C.reset : "(無し)"}`
  );

  // ── プリフライト（OPTIONS）の処理 ────────────────────────
  //
  // ブラウザは「単純リクエストではない」と判断すると、本番の前に
  // OPTIONS を1本送って許可を確認する。これがプリフライト。
  // 見分け方は Access-Control-Request-Method ヘッダーがあるかどうか。
  if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
    const wantMethod = req.headers["access-control-request-method"];
    const wantHeaders = req.headers["access-control-request-headers"] ?? "(無し)";

    console.log(`  ${C.yellow}★ これはプリフライトです${C.reset}`);
    console.log(`    これから使いたいメソッド : ${wantMethod}`);
    console.log(`    これから付けたいヘッダー : ${wantHeaders}`);

    // /api/strict はプリフライトに応答しない（＝許可しない）
    if (req.path === "/api/strict") {
      console.log(`    ${C.red}→ このパスはプリフライトに応答しません${C.reset}`);
      return res.text(404, "no preflight here\n");
    }

    console.log(`    ${C.green}→ 許可します${C.reset}`);

    // プリフライトへの応答。ボディは不要なので 204。
    return res.send(204, {
      // 誰からの問い合わせを許すか
      "Access-Control-Allow-Origin": "*",
      // どのメソッドを許すか（Allow ではなくこの専用ヘッダーで答える）
      "Access-Control-Allow-Methods": ALLOW_METHODS,
      // どの独自ヘッダーを許すか
      "Access-Control-Allow-Headers": ALLOW_HEADERS,
    });
  }

  // ── 本番リクエストの処理 ─────────────────────────────────
  const payload = {
    message: "本番リクエストの応答です",
    method: req.method,
    path: req.path,
    受け取ったXDemo: req.headers["x-demo"] ?? "(無し)",
    受け取ったボディ: req.body.toString("utf8") || "(空)",
  };

  // プリフライトが通っても、本番の応答にACAOが無ければ読めない。
  // 「プリフライトは入場許可、本番のACAOは中身の閲覧許可」だと思うとよい。
  if (req.path === "/api/preflight-only") {
    console.log(`  ${C.red}→ わざと Access-Control-Allow-Origin を付けずに返します${C.reset}`);
    return res.json(200, payload);
  }

  res.json(200, payload, { "Access-Control-Allow-Origin": "*" });
}, "[API 8081]").listen(PORT_API);

createHttpServer((req, res) => {
  console.log(`${C.bold}[ページ 8080] ${req.method} ${req.path}${C.reset}`);
  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[ページ 8080]").listen(PORT_PAGE, () => {
  console.log("============================================");
  console.log(" step14: プリフライト");
  console.log("============================================");
  console.log(` オリジンA（ページ）: http://localhost:${PORT_PAGE}`);
  console.log(` オリジンB（API）   : http://localhost:${PORT_API}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PAGE}/ を開いてください`);
  console.log(" ※ プリフライトが飛ぶとこのコンソールに ★ が出ます");
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step14: プリフライト</title>
<style>
 body{font-family:sans-serif;max-width:52em;margin:2em auto;line-height:1.8;padding:0 1em}
 button{font-size:.95em;padding:.5em 1em;margin:.2em 0;display:block;width:100%;text-align:left}
 .log{background:#111;color:#eee;padding:1em;border-radius:6px;white-space:pre-wrap;
      font-family:monospace;font-size:13px;min-height:8em}
 .ok{color:#4ade80} .ng{color:#f87171} .hint{color:#fbbf24}
 code{background:#eee;padding:1px 4px;border-radius:3px}
 table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
 th{background:#f3f4f6}
</style>
<body>
<h1>step14: プリフライト</h1>
<p>ページ: <strong id="origin"></strong>　／　API: <strong>http://localhost:8081</strong></p>

<h2>成功する例（プリフライトが通る）</h2>
<button onclick="run('POST','/api/ok',{'Content-Type':'application/json'},true)">
  ① POST /api/ok　Content-Type: application/json</button>
<button onclick="run('PUT','/api/ok',{'Content-Type':'application/json'},true)">
  ② PUT /api/ok</button>
<button onclick="run('DELETE','/api/ok',{},false)">
  ③ DELETE /api/ok</button>
<button onclick="run('GET','/api/ok',{'X-Demo':'hello'},false)">
  ④ GET /api/ok　＋ 独自ヘッダー X-Demo（GETでもプリフライトが飛ぶ）</button>

<h2>失敗する例</h2>
<button onclick="run('POST','/api/strict',{'Content-Type':'application/json'},true)">
  ⑤ POST /api/strict　… OPTIONS に応答しないAPI</button>
<button onclick="run('GET','/api/ok',{'X-Secret':'x'},false)">
  ⑥ GET /api/ok　＋ 許可されていないヘッダー X-Secret</button>
<button onclick="run('PUT','/api/preflight-only',{'Content-Type':'application/json'},true)">
  ⑦ PUT /api/preflight-only　… プリフライトは通るが本番にACAOが無い</button>

<h2>結果</h2>
<div class="log" id="log">ボタンを押してください</div>

<h2>プリフライトのやりとり</h2>
<pre style="background:#f6f8fa;padding:1em;border-radius:6px">→ OPTIONS /api/ok HTTP/1.1
   Origin: http://localhost:8080
   Access-Control-Request-Method: PUT          ← これから使いたいメソッド
   Access-Control-Request-Headers: content-type ← これから付けたいヘッダー

← HTTP/1.1 204 No Content
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
   Access-Control-Allow-Headers: Content-Type, X-Demo

（ここで初めて本番が送られる）
→ PUT /api/ok HTTP/1.1
   Origin: http://localhost:8080
   Content-Type: application/json

← HTTP/1.1 200 OK
   Access-Control-Allow-Origin: *      ← 本番にも必要！
</pre>

<h2>プリフライトが飛ぶ条件</h2>
<p>step13 の「単純リクエスト」の条件を1つでも外れると飛びます。</p>
<table>
<tr><th>やること</th><th>プリフライト</th></tr>
<tr><td><code>GET</code> / <code>HEAD</code></td><td>飛ばない</td></tr>
<tr><td><code>POST</code> + <code>text/plain</code> など3種のContent-Type</td><td>飛ばない</td></tr>
<tr><td><code>POST</code> + <code>application/json</code></td><td><strong>飛ぶ</strong></td></tr>
<tr><td><code>PUT</code> / <code>DELETE</code> / <code>PATCH</code></td><td><strong>飛ぶ</strong></td></tr>
<tr><td>独自ヘッダー（<code>X-Demo</code>, <code>Authorization</code> など）を付ける</td><td><strong>飛ぶ</strong>（メソッドがGETでも）</td></tr>
</table>

<script>
document.getElementById('origin').textContent = location.origin;
var API = 'http://localhost:8081';
var logEl = document.getElementById('log');
function log(msg, cls) {
  var s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = msg + '\\n';
  logEl.appendChild(s);
}
function clear() { logEl.textContent = ''; }

async function run(method, path, headers, withBody) {
  clear();
  log(method + ' ' + API + path);
  for (var k in headers) log('  ' + k + ': ' + headers[k]);
  log('');
  try {
    var init = { method: method, headers: headers };
    // ボディはここで組み立てる。
    // onclick属性の中にJSONを書くと、" がHTML属性を途中で終端してしまう。
    if (withBody) init.body = JSON.stringify({ a: 1 });
    var r = await fetch(API + path, init);
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
    log('');
    log('サーバのコンソールを見てください。', 'hint');
    log('★ の付いた OPTIONS のあとに本番が届いているはずです。', 'hint');
  } catch (e) {
    log('失敗: ' + e, 'ng');
    log('');
    if (path === '/api/strict') {
      log('→ プリフライトに 404 が返ったため、本番は送られませんでした。', 'hint');
      log('  コンソールに本番の POST が無いことを確認してください。', 'hint');
      log('  ブラウザは「許可が取れなければ本番を送らない」のです。', 'hint');
    } else if (path === '/api/preflight-only') {
      log('→ プリフライトは通りました（★ が出ています）。', 'hint');
      log('  本番も届いています（200 を返しています）。', 'hint');
      log('  しかし本番の応答に Access-Control-Allow-Origin が無いので読めません。', 'hint');
      log('  プリフライト＝入場許可、本番のACAO＝閲覧許可。両方必要です。', 'hint');
    } else {
      log('→ Access-Control-Allow-Headers に X-Secret が含まれていないため、', 'hint');
      log('  プリフライトの段階で拒否されました。', 'hint');
      log('  サーバのログで「これから付けたいヘッダー」を確認してください。', 'hint');
    }
    log('');
    log('DevTools の Network タブで OPTIONS の行を探してください。');
  }
}
</script>
</body></html>
`;
