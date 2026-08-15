// ============================================================
// step10: Cookie の往復
//
// step09 との差分（HTTPコアは変更なし）:
//   - リクエストの Cookie ヘッダーを分解する parseCookie()
//   - レスポンスで Set-Cookie を返す
//   - Set-Cookie は「連結してはいけない唯一のヘッダー」
//
//   $ node server.js
// ============================================================

import net from "node:net";

const PORT = 8080;

// ────────────────────────────────────────────────────────────
// ここから ▼ HTTPコア（step06以降も同じものを使います）
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
 *   req = { method, target, path, query, version, headers, body, raw }
 *   res = { send, text, html, json }
 */
function createHttpServer(handler) {
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

        dump(`▼ 受信 [この接続の ${reqCount} 本目]`, C.cyan, raw);

        // パスとクエリを分ける
        const qIndex = (target ?? "/").indexOf("?");
        const path = qIndex === -1 ? target : target.slice(0, qIndex);
        const query = qIndex === -1 ? "" : target.slice(qIndex + 1);

        const req = { method, target, path, query, version, headers, body, raw };
        const res = makeResponse(socket, req);

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

function makeResponse(socket, req) {
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

      dump("▲ 送信", C.green, packet);
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

/**
 * リクエストの Cookie ヘッダーを分解する。
 *
 *   Cookie: visits=3; theme=dark; lang=ja
 *           └───────────────┬──────────────┘
 *            "; " 区切りで1行にまとまっている（1つのヘッダー）
 *
 * リクエスト側は必ず1行。属性(Path や HttpOnly)は送られてこない。
 * ブラウザは「名前と値」だけを返す。
 */
function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const server = createHttpServer((req, res) => {
  const cookies = parseCookie(req.headers["cookie"]);
  console.log(`${C.bold}${req.method} ${req.target}${C.reset}`);
  console.log("  ブラウザが送ってきたCookie:", cookies);

  // --- Cookieを消す -------------------------------------------
  if (req.path === "/reset") {
    // 「削除」という命令は存在しない。
    // Max-Age=0（＝寿命ゼロ）の Set-Cookie を送ると、ブラウザが捨てる。
    return res.send(302, {
      "Location": "/",
      "Set-Cookie": [
        "visits=; Max-Age=0; Path=/",
        "first_seen=; Max-Age=0; Path=/",
      ],
    }, "");
  }

  if (req.path !== "/" && req.path !== "/whoami") {
    return res.text(404, `404 Not Found: ${req.path}\n`);
  }

  // --- 訪問回数を数える ---------------------------------------
  // サーバは何も覚えていない。数えているのはブラウザが持ってきた値。
  const visits = Number(cookies.visits ?? 0) + 1;
  const firstSeen = cookies.first_seen ?? new Date().toISOString();

  // Set-Cookie は「名前=値」に続けて「; 属性」を並べる。
  // ここではまだ Path だけ。属性は step11 で扱う。
  const setCookie = [
    `visits=${visits}; Path=/`,
    // 値に記号や日本語を入れるならエンコードが必要（; や , は使えない）
    `first_seen=${encodeURIComponent(firstSeen)}; Path=/`,
  ];

  if (req.path === "/whoami") {
    return res.json(200, { cookies, visits }, { "Set-Cookie": setCookie });
  }

  const rows = Object.entries(cookies)
    .map(([k, v]) => `<tr><td><code>${k}</code></td><td>${v}</td></tr>`)
    .join("") || `<tr><td colspan="2">（まだ何も無い）</td></tr>`;

  res.html(200, `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step10: Cookie</title>
<body style="font-family:sans-serif;max-width:44em;margin:3em auto;line-height:1.9">
<h1>step10: Cookie の往復</h1>

<p style="font-size:1.6em">このページを <strong>${visits}</strong> 回開きました</p>
<p>初回アクセス: ${firstSeen}</p>

<p><button onclick="location.reload()">リロード（数字が増えます）</button>
<a href="/reset"><button>Cookieを消す</button></a></p>

<h2>サーバが受け取った Cookie ヘッダー</h2>
<pre style="background:#eee;padding:1em">Cookie: ${req.headers["cookie"] ?? "(このリクエストには無し)"}</pre>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>名前</th><th>値</th></tr>${rows}</table>

<h2>JavaScript から見た document.cookie</h2>
<pre id="js" style="background:#eee;padding:1em"></pre>
<script>document.getElementById('js').textContent = document.cookie || '(空)';</script>

<h2>確かめてほしいこと</h2>
<ol>
  <li>DevTools の Network タブでこのページのリクエストを選び、
      <strong>Request Headers の Cookie</strong> と
      <strong>Response Headers の Set-Cookie</strong> を見比べる</li>
  <li>Application タブ → Cookies でブラウザの保管庫を見る</li>
  <li>サーバのコンソールで生の <code>Set-Cookie</code> が
      <strong>2行</strong>出ていることを確認する</li>
</ol>
</body></html>
`, { "Set-Cookie": setCookie });
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step10: Cookie の往復");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   ブラウザで http://localhost:8080/ を何度もリロード");
  console.log("");
  console.log("   # curl は既定でCookieを覚えない → 何度やっても1回目");
  console.log("   curl -i http://localhost:8080/whoami");
  console.log("");
  console.log("   # -c で保存, -b で送信 → 数字が増える");
  console.log("   curl -c jar.txt -b jar.txt http://localhost:8080/whoami");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
