// ============================================================
// step07: POST
//
// step06 との差分（HTTPコアは変更なし）:
//   - Content-Type を見てボディの読み方を切り替える
//       application/x-www-form-urlencoded → key=value&key=value
//       application/json                  → JSON.parse
//   - 知らない形式には 415 Unsupported Media Type を返す
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

/** step06 と同じ。クエリ文字列とフォーム形式のボディは同じ書式なので使い回せる。 */
function parseUrlEncoded(text) {
  const out = {};
  if (!text) return out;
  for (const pair of text.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
    const name = decode(rawName);
    const value = decode(rawValue);
    if (name in out) out[name] = [].concat(out[name], value);
    else out[name] = value;
  }
  return out;
}

/**
 * Content-Type を見てボディを解釈する。
 *
 * Content-Type は "application/json; charset=utf-8" のように
 * パラメータが付くことがあるので、";" より前だけを見る。
 */
function parseBody(req) {
  const raw = req.body.toString("utf8");
  const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

  if (raw.length === 0) return { type: "(空)", data: null };

  if (contentType === "application/x-www-form-urlencoded") {
    return { type: contentType, data: parseUrlEncoded(raw) };
  }

  if (contentType === "application/json") {
    try {
      return { type: contentType, data: JSON.parse(raw) };
    } catch (err) {
      return { type: contentType, error: "JSONとして壊れています: " + err.message };
    }
  }

  if (contentType === "text/plain") {
    return { type: contentType, data: raw };
  }

  return { type: contentType || "(Content-Typeなし)", unsupported: true };
}

const server = createHttpServer((req, res) => {
  console.log(`${C.bold}${req.method} ${req.target}${C.reset}`);

  if (req.path === "/" && req.method === "GET") {
    return res.html(200, `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step07: POST</title>
<body style="font-family:sans-serif;max-width:44em;margin:3em auto;line-height:1.9">
<h1>step07: POST</h1>

<h2>1. HTMLフォームのPOST（application/x-www-form-urlencoded）</h2>
<form action="/submit" method="POST">
  <input name="name" value="山田 太郎" size="20">
  <input name="age" value="20" size="4">
  <button>POSTで送信</button>
</form>
<p>送信後、アドレスバーは <code>/submit</code> のまま。
<strong>入力内容はURLではなくボディに入っています。</strong>
サーバのコンソールで生の通信を見てください。</p>

<h2>2. JSONのPOST（fetch）</h2>
<button onclick="sendJson()">JSONを送信</button>
<pre id="out" style="background:#eee;padding:1em"></pre>
<script>
async function sendJson() {
  const r = await fetch('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '山田 太郎', age: 20, tags: ['a','b'] })
  });
  document.getElementById('out').textContent = await r.text();
}
</script>
</body></html>
`);
  }

  if (req.path === "/submit" && req.method === "POST") {
    const parsed = parseBody(req);

    console.log("  Content-Type :", req.headers["content-type"] ?? "(なし)");
    console.log("  生のボディ   :", JSON.stringify(req.body.toString("utf8")));
    console.log("  解釈結果     :", parsed);

    // 知らない形式は 415。「文法は正しいが、この形式は受け付けない」の意味。
    if (parsed.unsupported) {
      return res.json(415, {
        error: "Unsupported Media Type",
        受け取ったContentType: parsed.type,
        対応している形式: ["application/x-www-form-urlencoded", "application/json", "text/plain"],
      });
    }

    if (parsed.error) return res.json(400, { error: parsed.error });

    return res.json(200, {
      受け取りました: true,
      ContentType: parsed.type,
      生のボディ: req.body.toString("utf8"),
      バイト数: req.body.length,
      解釈結果: parsed.data,
    });
  }

  if (req.path === "/submit") {
    return res.text(405, `/submit は POST のみです（受け取ったのは ${req.method}）\n`, { "Allow": "POST" });
  }

  res.text(404, `404 Not Found: ${req.path}\n`);
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step07: POST");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   ブラウザで http://localhost:8080/");
  console.log("   curl -v -d 'name=taro&age=20' http://localhost:8080/submit");
  console.log("   curl -v -H 'Content-Type: application/json' \\");
  console.log("        -d '{\"name\":\"太郎\"}' http://localhost:8080/submit");
  console.log("   curl -v -H 'Content-Type: application/xml' \\");
  console.log("        -d '<a/>' http://localhost:8080/submit   ← 415 が返る");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
