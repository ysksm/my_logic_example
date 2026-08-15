// ============================================================
// step17: Access-Control-Expose-Headers
//
// step16 との差分:
//   - レスポンスヘッダーは、クロスオリジンでは既定でJSから読めない
//   - Access-Control-Expose-Headers で「読んでよいヘッダー」を指定する
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

let requestSeq = 0;

/** どのエンドポイントでも同じカスタムヘッダーを付けて返す */
function demoHeaders() {
  return {
    "X-Total-Count": "1234",
    "X-Request-Id": `req-${++requestSeq}`,
    "X-Rate-Limit-Remaining": "42",
    // これは「CORSセーフリスト済みレスポンスヘッダー」なので、
    // 何もしなくてもJSから読める
    "Cache-Control": "no-store",
  };
}

createHttpServer((req, res) => {
  const origin = req.headers["origin"];
  console.log(`${C.bold}[API 8081] ${req.method} ${req.path}${C.reset}  Origin: ${origin ?? "(無し)"}`);

  const body = { message: "ヘッダーを見てください", items: [1, 2, 3] };

  // (1) 何も指定しない → カスタムヘッダーはJSから読めない
  if (req.path === "/api/hidden") {
    console.log("  → Expose-Headers なし。ヘッダー自体は送っています");
    return res.json(200, body, {
      ...demoHeaders(),
      "Access-Control-Allow-Origin": "*",
    });
  }

  // (2) 読んでよいヘッダーを列挙する
  if (req.path === "/api/exposed") {
    console.log("  → Expose-Headers あり");
    return res.json(200, body, {
      ...demoHeaders(),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Total-Count, X-Request-Id",
      // ↑ X-Rate-Limit-Remaining は入れていないので、これだけ読めないまま
    });
  }

  // (3) ワイルドカード。credentials を使わない場合のみ有効。
  if (req.path === "/api/exposed-all") {
    console.log("  → Expose-Headers: * （credentials無しのときだけ有効）");
    return res.json(200, body, {
      ...demoHeaders(),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "*",
    });
  }

  res.json(404, { error: "Not Found" }, { "Access-Control-Allow-Origin": "*" });
}, "[API 8081]").listen(PORT_API);

createHttpServer((req, res) => {
  // 比較用: 同一オリジンなら、指定しなくても全ヘッダーが読める
  if (req.path === "/api/same-origin") {
    console.log(`${C.bold}[ページ 8080] 同一オリジンのAPI${C.reset}`);
    return res.json(200, { message: "同一オリジンからの応答" }, demoHeaders());
  }
  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[ページ 8080]").listen(PORT_PAGE, () => {
  console.log("============================================");
  console.log(" step17: Access-Control-Expose-Headers");
  console.log("============================================");
  console.log(` オリジンA（ページ）: http://localhost:${PORT_PAGE}`);
  console.log(` オリジンB（API）   : http://localhost:${PORT_API}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PAGE}/ を開いてください`);
  console.log("");
  console.log(" curl では常に全ヘッダーが見えます（ブラウザだけの制限だから）:");
  console.log("   curl -i http://localhost:8081/api/hidden");
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step17: Expose-Headers</title>
<style>
 body{font-family:sans-serif;max-width:52em;margin:2em auto;line-height:1.8;padding:0 1em}
 button{font-size:.95em;padding:.5em 1em;margin:.2em 0;display:block;width:100%;text-align:left}
 .log{background:#111;color:#eee;padding:1em;border-radius:6px;white-space:pre-wrap;
      font-family:monospace;font-size:13px;min-height:6em}
 .ok{color:#4ade80} .ng{color:#f87171} .hint{color:#fbbf24}
 code{background:#eee;padding:1px 4px;border-radius:3px}
 table{border-collapse:collapse;width:100%;margin:1em 0}
 th,td{border:1px solid #ccc;padding:6px 10px;text-align:left} th{background:#f3f4f6}
 .yes{color:#15803d;font-weight:bold} .no{color:#b91c1c;font-weight:bold}
</style>
<body>
<h1>step17: <code>Access-Control-Expose-Headers</code></h1>

<p>CORSが制限しているのは<strong>ボディだけではありません</strong>。
レスポンスヘッダーも、クロスオリジンでは既定でほとんど読めません。</p>

<button onclick="check('http://localhost:8081/api/hidden')">
  ① クロスオリジン　/api/hidden　… Expose-Headers なし</button>
<button onclick="check('http://localhost:8081/api/exposed')">
  ② クロスオリジン　/api/exposed　… Expose-Headers: X-Total-Count, X-Request-Id</button>
<button onclick="check('http://localhost:8081/api/exposed-all')">
  ③ クロスオリジン　/api/exposed-all　… Expose-Headers: *</button>
<button onclick="check('/api/same-origin')">
  ④ 同一オリジン　/api/same-origin　… 何も指定していない</button>

<h2>JSから読めたヘッダー</h2>
<table id="result">
<tr><th>ヘッダー</th><th>読めた値</th></tr>
</table>
<div class="log" id="log">ボタンを押してください</div>

<h2>指定しなくても読める7つ（CORSセーフリスト済みレスポンスヘッダー）</h2>
<ul style="columns:2">
<li><code>Cache-Control</code></li>
<li><code>Content-Language</code></li>
<li><code>Content-Length</code></li>
<li><code>Content-Type</code></li>
<li><code>Expires</code></li>
<li><code>Last-Modified</code></li>
<li><code>Pragma</code></li>
</ul>
<p>これ以外（<code>X-Total-Count</code> のような独自ヘッダー、
<code>Location</code>、<code>Set-Cookie</code> など）は、
サーバが明示的に公開しない限りJSからは読めません。</p>

<h2>実務でよくある場面</h2>
<ul>
<li>ページネーションの総件数を <code>X-Total-Count</code> で返している</li>
<li>レート制限の残り回数を <code>X-RateLimit-Remaining</code> で返している</li>
<li>作成したリソースのURLを <code>Location</code> で返している</li>
</ul>
<p>いずれも「サーバは返しているのにフロントで <code>null</code> になる」という形で顕在化します。
サーバのログにもDevToolsのNetworkタブにもヘッダーは見えているので、原因に気づきにくいのが厄介です。<br>
<strong>DevToolsのNetworkタブに見えている＝JSから読める、ではありません。</strong></p>

<p><code>Access-Control-Expose-Headers: *</code> はワイルドカードですが、
<code>credentials: 'include'</code> のリクエストでは無効になり、
<code>*</code> という名前のヘッダーを探す扱いになります。
credentials を使うなら必ず個別に列挙してください。</p>

<script>
var logEl = document.getElementById('log');
var table = document.getElementById('result');
var WATCH = ['X-Total-Count','X-Request-Id','X-Rate-Limit-Remaining','Cache-Control','Content-Type'];
function log(msg, cls) {
  var s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = msg + '\\n';
  logEl.appendChild(s);
}

async function check(url) {
  logEl.textContent = '';
  while (table.rows.length > 1) table.deleteRow(1);
  log('GET ' + url);
  try {
    var r = await fetch(url);
    log('status=' + r.status, 'ok');
    var readable = 0;
    WATCH.forEach(function (name) {
      var v = r.headers.get(name);
      var tr = table.insertRow();
      tr.insertCell().innerHTML = '<code>' + name + '</code>';
      var cell = tr.insertCell();
      if (v === null) { cell.innerHTML = '<span class="no">読めない (null)</span>'; }
      else { cell.innerHTML = '<span class="yes">' + v + '</span>'; readable++; }
    });
    log('');
    log('読めたヘッダー: ' + readable + ' / ' + WATCH.length, 'hint');
    if (url.indexOf('/api/hidden') >= 0) {
      log('X-系がすべて null です。しかしサーバは送っています。', 'hint');
      log('DevTools の Network タブ → Response Headers を見てください。', 'hint');
      log('ちゃんと表示されているのに、JSからは読めません。', 'hint');
      log('Cache-Control だけ読めるのは、セーフリストに入っているからです。', 'hint');
    } else if (url.indexOf('/api/exposed') >= 0 && url.indexOf('all') < 0) {
      log('列挙した2つだけ読めるようになりました。', 'hint');
      log('X-Rate-Limit-Remaining は列挙していないので読めないままです。', 'hint');
    } else if (url.indexOf('same-origin') >= 0) {
      log('同一オリジンなら何も指定しなくても全部読めます。', 'hint');
      log('この制限はクロスオリジンのときだけのものです。', 'hint');
    }
  } catch (e) {
    log('失敗: ' + e, 'ng');
  }
}
</script>
</body></html>
`;
