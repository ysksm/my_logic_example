// ============================================================
// step05: レスポンスを組み立てる ＋ keep-alive
//
// step04 との差分:
//   - リクエストを読み切ったらバッファから取り除き、ループでもう一度読む
//     → 1本のTCP接続で複数のリクエストを処理できる（keep-alive）
//   - レスポンスを組み立てる部品 res.text() / res.json() / res.html() を用意
//
// ここで作った「HTTPコア」を step06 以降ずっと使い回します。
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

      // ▼▼▼ このステップの新しい部分：ループで何度でも読む ▼▼▼
      // 1本の接続に「リクエスト → 応答 → リクエスト → 応答」と
      // 続けて流れてくるのが keep-alive。だから while で回す。
      while (!closed) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break; // ヘッダーがまだ揃っていない

        const headText = buffer.subarray(0, headerEnd).toString("utf8");
        const lines = headText.split("\r\n");
        const [method, target, version] = lines[0].split(" ");

        const headers = Object.create(null);
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
      // ▲▲▲ ここまで ▲▲▲
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

// ── アプリケーション部分 ─────────────────────────────────

const server = createHttpServer((req, res) => {
  console.log(`${C.bold}${req.method} ${req.target}${C.reset}`);

  if (req.path === "/") {
    return res.html(200, `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step05</title>
<body style="font-family:sans-serif;max-width:40em;margin:3em auto;line-height:1.8">
<h1>step05: レスポンスを組み立てる</h1>
<p>このページは <code>res.html(200, ...)</code> が返しています。</p>
<ul>
  <li><a href="/plain">/plain</a> — text/plain</li>
  <li><a href="/json">/json</a> — application/json</li>
  <li><a href="/empty">/empty</a> — 204 No Content（ボディなし）</li>
  <li><a href="/nowhere">/nowhere</a> — 404</li>
</ul>
<p>DevTools の Network タブを開いて、<code>Connection: keep-alive</code> を確かめてください。</p>
</body></html>
`);
  }

  if (req.path === "/plain") return res.text(200, "ただのテキストです\n");

  if (req.path === "/json") {
    return res.json(200, { message: "これはJSONです", method: req.method, path: req.path });
  }

  // 204 は「成功したが返す中身はない」。ボディを持ってはいけない。
  if (req.path === "/empty") return res.send(204);

  res.text(404, `404 Not Found: ${req.path}\n`);
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step05: レスポンスを組み立てる ＋ keep-alive");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   curl -v http://localhost:8080/json");
  console.log("   curl -v http://localhost:8080/plain http://localhost:8080/json");
  console.log("     ↑ URLを2つ渡すと1本の接続を使い回す（keep-alive）");
  console.log("   curl -v -H 'Connection: close' http://localhost:8080/plain");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
