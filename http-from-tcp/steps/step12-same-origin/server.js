// ============================================================
// step12: 同一オリジンポリシー
//
// 第4章のはじまり。ここから2つのサーバを1プロセスで動かします。
//
//   オリジンA  http://localhost:8080  … 実験ページを配る（ブラウザが表示する側）
//   オリジンB  http://localhost:8081  … API（別オリジン）
//
// step11 との差分:
//   - HTTPコアに「どちらのサーバのログか」を示す label を追加しただけ
//   - APIは CORS ヘッダーを一切返さない（これが今回の主役）
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

const PORT_PAGE = 8080; // オリジンA: ページ
const PORT_API = 8081;  // オリジンB: API

// ── オリジンB：API（CORSヘッダーは一切付けない） ──────────
createHttpServer((req, res) => {
  // Origin ヘッダーは「このリクエストはどのページから出たのか」をブラウザが付けるもの。
  // curl では付かない。ブラウザのfetchでは付く。
  const origin = req.headers["origin"];
  console.log(
    `${C.bold}[API 8081] ${req.method} ${req.path}${C.reset}` +
    `  Origin: ${origin ? C.yellow + origin + C.reset : "(無し = ブラウザ以外か同一オリジン)"}`
  );

  if (req.path === "/api/hello") {
    // ここが重要:
    // このサーバは何も拒否していない。200 OK と JSON を普通に返している。
    // それでもブラウザ側のJSは、この中身を読むことができない。
    return res.json(200, {
      message: "APIからの応答です",
      あなたのOrigin: origin ?? "(無し)",
      注意: "このJSONはブラウザに届いています。ただしJSは読めません。",
    });
  }

  if (req.path === "/api/pixel") {
    // 1x1 の透明GIF。<img> から読み込む実験用。
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    return res.send(200, { "Content-Type": "image/gif" }, gif);
  }

  res.json(404, { error: "Not Found" });
}, "[API 8081]").listen(PORT_API);

// ── オリジンA：実験ページ ─────────────────────────────────
createHttpServer((req, res) => {
  console.log(`${C.bold}[ページ 8080] ${req.method} ${req.path}${C.reset}`);

  // 比較用の「同一オリジンのAPI」。8080 自身が返すので何の制限も受けない。
  if (req.path === "/api/same-origin") {
    return res.json(200, { message: "これは 8080 自身が返しました（同一オリジン）" });
  }

  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[ページ 8080]").listen(PORT_PAGE, () => {
  console.log("============================================");
  console.log(" step12: 同一オリジンポリシー");
  console.log("============================================");
  console.log(` オリジンA（ページ）: http://localhost:${PORT_PAGE}`);
  console.log(` オリジンB（API）   : http://localhost:${PORT_API}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PAGE}/ を開いてください`);
  console.log(" ※ 必ずこのコンソールも見えるようにしておくこと");
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step12: 同一オリジンポリシー</title>
<style>
 body{font-family:sans-serif;max-width:50em;margin:2em auto;line-height:1.8;padding:0 1em}
 button{font-size:1em;padding:.5em 1em;margin:.2em 0}
 .log{background:#111;color:#eee;padding:1em;border-radius:6px;white-space:pre-wrap;
      font-family:monospace;font-size:13px;min-height:6em}
 .ok{color:#4ade80} .ng{color:#f87171} .note{background:#fef3c7;padding:1em;border-radius:6px}
 code{background:#eee;padding:1px 4px;border-radius:3px}
</style>
<body>
<h1>step12: 同一オリジンポリシー</h1>
<p>このページのオリジンは <strong id="origin"></strong> です。</p>

<h2>実験1: 同じオリジンのAPIを呼ぶ</h2>
<button onclick="sameOrigin()">GET http://localhost:8080/api/same-origin</button>

<h2>実験2: 別のオリジンのAPIを呼ぶ</h2>
<button onclick="crossOrigin()">GET http://localhost:8081/api/hello</button>
<p class="note">
失敗します。<strong>そのあと必ずサーバのコンソールを見てください。</strong><br>
<code>[API 8081] GET /api/hello</code> というログが出ているはずです。
つまり<strong>リクエストは届き、200 OK も返っています</strong>。
</p>

<h2>実験3: 同じ別オリジンを &lt;img&gt; で読む</h2>
<button onclick="loadImage()">&lt;img src="http://localhost:8081/api/pixel"&gt;</button>
<span id="img"></span>
<p class="note">
こちらは<strong>成功します</strong>。<code>&lt;img&gt;</code> や <code>&lt;script&gt;</code> や
<code>&lt;form&gt;</code> は昔から他オリジンを読み込めます。<br>
同一オリジンポリシーが止めているのは「送ること」ではなく
<strong>「JavaScriptが中身を読むこと」</strong>です。
</p>

<h2>結果</h2>
<div class="log" id="log">ここに結果が出ます</div>

<script>
document.getElementById('origin').textContent = location.origin;
var logEl = document.getElementById('log');
function log(msg, cls) {
  var span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = msg + '\\n';
  logEl.appendChild(span);
}
function clear() { logEl.textContent = ''; }

async function sameOrigin() {
  clear();
  log('fetch("/api/same-origin") …');
  try {
    var r = await fetch('/api/same-origin');
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
  } catch (e) {
    log('失敗: ' + e, 'ng');
  }
}

async function crossOrigin() {
  clear();
  log('fetch("http://localhost:8081/api/hello") …');
  try {
    var r = await fetch('http://localhost:8081/api/hello');
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
  } catch (e) {
    log('失敗: ' + e, 'ng');
    log('');
    log('↑ これは「サーバが拒否した」のではありません。', 'ng');
    log('  サーバは 200 OK を返しています（コンソールを見てください）。', 'ng');
    log('  ブラウザが「読ませない」と判断しただけです。', 'ng');
    log('');
    log('DevTools の Console と Network タブも見てください。');
    log('Network では該当リクエストが (blocked:cors) や CORS error として残っています。');
  }
}

function loadImage() {
  clear();
  var img = new Image();
  img.onload = function () {
    log('画像の読み込みに成功しました（' + img.width + 'x' + img.height + '）', 'ok');
    log('');
    log('別オリジンなのに成功しました。', 'ok');
    log('<img> はレスポンスの「中身」をJSに渡さないので、許されています。', 'ok');
    log('canvas に描いて getImageData() しようとすると、そこで初めて止められます。');
  };
  img.onerror = function () { log('画像の読み込みに失敗しました', 'ng'); };
  img.src = 'http://localhost:8081/api/pixel?t=' + Date.now();
  document.getElementById('img').appendChild(img);
}
</script>
</body></html>
`;
