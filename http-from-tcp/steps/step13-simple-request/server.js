// ============================================================
// step13: 単純リクエストと Access-Control-Allow-Origin
//
// step12 との差分:
//   - APIが Access-Control-Allow-Origin を返すエンドポイントを用意
//   - 「単純リクエスト（simple request）」なら、この1行だけで通る
//   - 単純でないリクエストは通らない（→ step14 のプリフライトへ）
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

// ── オリジンB：API ────────────────────────────────────────
createHttpServer((req, res) => {
  const origin = req.headers["origin"];
  console.log(
    `${C.bold}[API 8081] ${req.method} ${req.path}${C.reset}` +
    `  Origin: ${origin ? C.yellow + origin + C.reset : "(無し)"}` +
    `  Content-Type: ${req.headers["content-type"] ?? "(無し)"}`
  );

  if (req.method === "OPTIONS") {
    // このステップではプリフライトにまだ対応していない。
    // ここにログが出たら「プリフライトが発生した」ということ。
    console.log(`  ${C.red}▲ OPTIONS が来ました＝プリフライトです。まだ対応していません（step14で対応）${C.reset}`);
    return res.text(404, "プリフライトには対応していません\n");
  }

  const payload = {
    message: "APIからの応答です",
    method: req.method,
    あなたのOrigin: origin ?? "(無し)",
    受け取ったボディ: req.body.toString("utf8") || "(空)",
  };

  // (1) CORSヘッダーを付けない → ブラウザは読ませない
  if (req.path === "/api/no-cors") {
    return res.json(200, payload);
  }

  // (2) 誰にでも許可する
  //     たった1行。これで単純リクエストは通るようになる。
  if (req.path === "/api/wildcard") {
    return res.json(200, payload, {
      "Access-Control-Allow-Origin": "*",
    });
  }

  // (3) ヘッダーはあるが、値がこのページのオリジンと一致しない
  //     → 一致しなければ無いのと同じ
  if (req.path === "/api/wrong-origin") {
    return res.json(200, payload, {
      "Access-Control-Allow-Origin": "https://example.com",
    });
  }

  res.json(404, { error: "Not Found" }, { "Access-Control-Allow-Origin": "*" });
}, "[API 8081]").listen(PORT_API);

// ── オリジンA：実験ページ ─────────────────────────────────
createHttpServer((req, res) => {
  console.log(`${C.bold}[ページ 8080] ${req.method} ${req.path}${C.reset}`);
  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[ページ 8080]").listen(PORT_PAGE, () => {
  console.log("============================================");
  console.log(" step13: 単純リクエストと Access-Control-Allow-Origin");
  console.log("============================================");
  console.log(` オリジンA（ページ）: http://localhost:${PORT_PAGE}`);
  console.log(` オリジンB（API）   : http://localhost:${PORT_API}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PAGE}/ を開いてください`);
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step13: Access-Control-Allow-Origin</title>
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
<h1>step13: 単純リクエストと <code>Access-Control-Allow-Origin</code></h1>
<p>ページのオリジン: <strong id="origin"></strong>　／　API: <strong>http://localhost:8081</strong></p>

<h2>A. GET（単純リクエスト）</h2>
<button onclick="get('/api/no-cors')">
  ① GET /api/no-cors　… CORSヘッダー無し</button>
<button onclick="get('/api/wildcard')">
  ② GET /api/wildcard　… Access-Control-Allow-Origin: *</button>
<button onclick="get('/api/wrong-origin')">
  ③ GET /api/wrong-origin　… Access-Control-Allow-Origin: https://example.com</button>

<h2>B. POST（Content-Type で結果が変わる）</h2>
<button onclick="post('text/plain')">
  ④ POST /api/wildcard　Content-Type: text/plain　… 単純リクエスト</button>
<button onclick="post('application/json')">
  ⑤ POST /api/wildcard　Content-Type: application/json　… 単純ではない</button>

<h2>結果</h2>
<div class="log" id="log">ボタンを押してください</div>

<h2>「単純リクエスト」の条件</h2>
<p>次を<strong>すべて</strong>満たすと単純リクエストになり、プリフライトなしで送られます。</p>
<table>
<tr><th>項目</th><th>条件</th></tr>
<tr><td>メソッド</td><td><code>GET</code> / <code>HEAD</code> / <code>POST</code> のいずれか</td></tr>
<tr><td>ヘッダー</td><td>手で付けたヘッダーが安全なもの（<code>Accept</code>,
  <code>Accept-Language</code>, <code>Content-Language</code>, <code>Content-Type</code>,
  <code>Range</code> など）だけ。<br>
  <code>Authorization</code> や <code>X-独自ヘッダー</code> を1つでも付けると単純ではなくなる</td></tr>
<tr><td>Content-Type</td><td><code>application/x-www-form-urlencoded</code> /
  <code>multipart/form-data</code> / <code>text/plain</code> のいずれか<br>
  <strong><code>application/json</code> は入っていない</strong></td></tr>
<tr><td>その他</td><td>アップロード進捗イベントを使っていない、
  <code>ReadableStream</code> をボディにしていない</td></tr>
</table>
<p>この条件は「<strong>HTMLのフォームで昔から送れたもの</strong>」とほぼ一致します。
フォームで送れる形なら、CORSが無かった時代から送れていたので、
いまさら止めても意味がない、という考え方です。</p>

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

async function get(path) {
  clear();
  log('GET ' + API + path);
  try {
    var r = await fetch(API + path);
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
  } catch (e) {
    log('失敗: ' + e, 'ng');
    if (path === '/api/no-cors') {
      log('→ Access-Control-Allow-Origin が無いため。', 'hint');
    }
    if (path === '/api/wrong-origin') {
      log('→ ヘッダーはありますが値が https://example.com。', 'hint');
      log('  このページは ' + location.origin + ' なので一致しません。', 'hint');
      log('  「有るか無いか」ではなく「一致するか」で判定されます。', 'hint');
    }
    log('DevTools の Console に詳しい理由が出ています。');
  }
}

async function post(contentType) {
  clear();
  log('POST ' + API + '/api/wildcard');
  log('Content-Type: ' + contentType);
  try {
    var r = await fetch(API + '/api/wildcard', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: contentType === 'application/json' ? '{"a":1}' : 'a=1'
    });
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
    log('');
    log('サーバのコンソールを見てください。OPTIONS は出ていないはずです。', 'hint');
    log('text/plain は「単純リクエスト」なので、いきなり本番が送られます。', 'hint');
  } catch (e) {
    log('失敗: ' + e, 'ng');
    log('');
    log('サーバのコンソールを見てください。', 'hint');
    log('POST ではなく OPTIONS が届いているはずです。', 'hint');
    log('application/json は単純リクエストの条件から外れるため、', 'hint');
    log('ブラウザが本番の前に「送っていいか」を尋ねに行きました。', 'hint');
    log('これがプリフライトです。次の step14 で対応します。', 'hint');
  }
}
</script>
</body></html>
`;
