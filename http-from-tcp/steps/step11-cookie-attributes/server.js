// ============================================================
// step11: Cookie 属性とセッション
//
// step10 との差分（HTTPコアは変更なし）:
//   - Set-Cookie の属性 Path / Max-Age / HttpOnly / Secure / SameSite
//   - セッションID方式のログイン（サーバ側に状態を持つ）
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

import { randomUUID } from "node:crypto";

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

function parseUrlEncoded(text) {
  const out = {};
  for (const pair of (text || "").split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
    out[dec(eq === -1 ? pair : pair.slice(0, eq))] = eq === -1 ? "" : dec(pair.slice(eq + 1));
  }
  return out;
}

// --- セッション置き場（サーバ側の記憶） ----------------------
// Cookieに入れるのは「鍵（セッションID）」だけ。
// 中身（誰なのか）はサーバが持つ。これがセッション方式。
const sessions = new Map();

const server = createHttpServer((req, res) => {
  const cookies = parseCookie(req.headers["cookie"]);
  const session = cookies.sid ? sessions.get(cookies.sid) : undefined;

  console.log(`${C.bold}${req.method} ${req.target}${C.reset}`);
  console.log("  受け取ったCookie:", cookies);
  console.log("  ログイン状態    :", session ? `${session.user} としてログイン中` : "未ログイン");

  // --- ログイン -----------------------------------------------
  if (req.path === "/login" && req.method === "POST") {
    const form = parseUrlEncoded(req.body.toString("utf8"));
    const user = (form.user || "").trim() || "ゲスト";

    // 推測できないIDを発行し、サーバ側の Map に本体を置く
    const sid = randomUUID();
    sessions.set(sid, { user, loginAt: new Date().toISOString() });

    return res.send(302, {
      "Location": "/",
      // セッションIDに付けるべき属性:
      //   HttpOnly  … JavaScript から読めなくする（XSSで盗まれるのを防ぐ）
      //   Path=/    … サイト全体に送る
      //   SameSite=Lax … 他サイトからのリクエストには原則付けない（CSRF対策）
      //   Secure    … HTTPSのときだけ送る（今回はhttpなので付けない）
      "Set-Cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`,
    }, "");
  }

  // --- ログアウト ---------------------------------------------
  if (req.path === "/logout" && req.method === "POST") {
    if (cookies.sid) sessions.delete(cookies.sid); // サーバ側も必ず消す
    return res.send(302, {
      "Location": "/",
      // 消すときは Max-Age=0。発行時と同じ Path を指定しないと消えない。
      "Set-Cookie": "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    }, "");
  }

  // --- 属性の実験用Cookieをまとめて配る ------------------------
  if (req.path === "/set-demo") {
    return res.send(302, { "Location": "/", "Set-Cookie": [
      // JSから読める。サイト全体に送られる。ブラウザを閉じると消える（セッションCookie）
      "plain=visible-to-js; Path=/",
      // JSから読めない。サーバにだけ届く
      "secret=js-cannot-read-me; Path=/; HttpOnly",
      // /admin 以下にアクセスしたときだけ送られる
      "area=admin-only; Path=/admin",
      // 10秒で消える
      "temp=gone-in-10s; Path=/; Max-Age=10",
      // HTTPSのときだけ送られる…が、localhost と 127.0.0.1 だけは例外。
      // ブラウザは localhost を「安全なオリジン」として扱うので、http でも保存される。
      // 本物のドメインを http で使うと、これは保存されない。
      "onlyhttps=secure-attr; Path=/; Secure",
    ] }, "");
  }

  if (req.path === "/clear-demo") {
    return res.send(302, { "Location": "/", "Set-Cookie": [
      "plain=; Path=/; Max-Age=0",
      "secret=; Path=/; Max-Age=0",
      "area=; Path=/admin; Max-Age=0",
      "temp=; Path=/; Max-Age=0",
      "onlyhttps=; Path=/; Max-Age=0",
    ] }, "");
  }

  // --- /admin 以下（Path属性の確認用） -------------------------
  if (req.path.startsWith("/admin")) {
    return res.html(200, page(req, cookies, session, true));
  }

  if (req.path === "/") return res.html(200, page(req, cookies, session, false));

  res.text(404, `404 Not Found: ${req.path}\n`);
});

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function page(req, cookies, session, isAdmin) {
  const rows = Object.entries(cookies)
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`)
    .join("") || `<tr><td colspan="2">（このリクエストにCookieは付いていません）</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step11: Cookie属性</title>
<body style="font-family:sans-serif;max-width:46em;margin:3em auto;line-height:1.9">
<h1>step11: Cookie 属性とセッション</h1>
<p>いま見ているURL: <code>${esc(req.path)}</code>
${isAdmin ? "（<strong>/admin 以下</strong>です）" : ""}</p>

<h2>ログイン</h2>
${session
  ? `<p><strong>${esc(session.user)}</strong> としてログイン中（${esc(session.loginAt)}）</p>
     <form action="/logout" method="POST"><button>ログアウト</button></form>`
  : `<form action="/login" method="POST">
       <input name="user" value="山田" placeholder="名前"> <button>ログイン</button>
     </form>`}
<p>セッションIDは <code>HttpOnly</code> なので、下の「JavaScriptから見えるCookie」には
<strong>出てきません</strong>。</p>

<h2>属性の実験</h2>
<p><a href="/set-demo"><button>属性つきCookieを5個受け取る</button></a>
<a href="/clear-demo"><button>消す</button></a></p>
<p><a href="/">/ を見る</a> ／ <a href="/admin">/admin を見る</a>
　←　行き来して <code>area</code> の有無を比べてください</p>

<h2>サーバが受け取った Cookie ヘッダー</h2>
<pre style="background:#eee;padding:1em;white-space:pre-wrap">Cookie: ${esc(req.headers["cookie"] ?? "(無し)")}</pre>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>名前</th><th>値</th></tr>${rows}</table>

<h2>JavaScript から見える Cookie（document.cookie）</h2>
<pre id="js" style="background:#eee;padding:1em;white-space:pre-wrap"></pre>
<script>document.getElementById('js').textContent = document.cookie || '(空)';</script>

<h2>確かめてほしいこと</h2>
<ol>
  <li><code>secret</code> と <code>sid</code> は上の表にあるのに、
      <code>document.cookie</code> には無い → これが <code>HttpOnly</code></li>
  <li><code>area</code> は <code>/admin</code> でだけ表に現れる → これが <code>Path</code></li>
  <li><code>temp</code> は10秒後にリロードすると消える → これが <code>Max-Age</code></li>
  <li><code>onlyhttps</code> は http なのに保存されている →
      ブラウザは <strong>localhost を例外的に「安全なオリジン」として扱う</strong>ため。
      本物のドメインを http で使うと保存されません（これが <code>Secure</code>）。
      この例外は step16 で <code>SameSite=None; Secure</code> を試すときに効いてきます</li>
</ol>
</body></html>
`;
}

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step11: Cookie 属性とセッション");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと（ブラウザ推奨）:");
  console.log("   1) http://localhost:8080/ を開く");
  console.log("   2) 「属性つきCookieを5個受け取る」を押す");
  console.log("   3) / と /admin を行き来して area の有無を比べる");
  console.log("   4) ログインして document.cookie に sid が無いことを確認");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
