// ============================================================
// step19（特別演習）: 同一オリジン化リバースプロキシ
//
// CORSを「設定する」のではなく「発生させない」もうひとつの解。
//
//   ブラウザ ──→ http://localhost:8080  … ページ＋プロキシ（同一オリジン）
//                      │ /api/* だけを転送
//                      ↓
//                http://localhost:9001  … バックエンドAPI（CORS設定は一切なし）
//
// ブラウザから見えるオリジンは 8080 ひとつだけ。
// だから同一オリジンポリシーの対象にならず、CORSは最初から発生しない。
//
// ここでサーバは初めて「TCPクライアント」になります。
// net.createConnection で自分から接続し、step02〜05 で組み立てたのと
// 同じ形のHTTPリクエストを書き込むだけです。
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

import { randomUUID } from "node:crypto";

const PORT_PROXY = 8080;   // ブラウザが見る唯一のオリジン
const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = 9001; // 裏側のAPI

// ============================================================
// (1) バックエンドAPI ― CORSのことは何も知らない普通のAPI
// ============================================================

const sessions = new Map();

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

const items = new Map([["1", { id: "1", name: "りんご", price: 120 }]]);

createHttpServer((req, res) => {
  const cookies = parseCookie(req.headers["cookie"]);
  const session = cookies.sid ? sessions.get(cookies.sid) : undefined;

  console.log(
    `${C.bold}[バックエンド 9001] ${req.method} ${req.path}${C.reset}\n` +
    `    Host            : ${req.headers["host"]}\n` +
    `    Origin          : ${req.headers["origin"] ?? C.green + "(無し)" + C.reset}\n` +
    `    X-Forwarded-For : ${req.headers["x-forwarded-for"] ?? "(無し)"}\n` +
    `    Cookie          : ${req.headers["cookie"] ?? "(無し)"}`
  );

  if (req.method === "OPTIONS") {
    console.log(`  ${C.red}★ OPTIONS が来ました（プロキシ経由なら来ないはずです）${C.reset}`);
  }

  if (req.path === "/api/login") {
    const sid = randomUUID();
    sessions.set(sid, { user: "山田", loginAt: new Date().toISOString() });
    // 属性はごく普通。SameSite=None も Secure も要らない。
    // プロキシ経由ならブラウザから見て 8080 のCookie（ファーストパーティ）になるため。
    return res.json(200, { ok: true, user: "山田" },
      { "Set-Cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
  }

  if (req.path === "/api/me") {
    return res.json(200, {
      ログイン中: Boolean(session),
      ユーザー: session ? session.user : null,
      バックエンドが受け取ったCookie: req.headers["cookie"] ?? "(無し)",
    });
  }

  if (req.path.startsWith("/api/items/")) {
    const id = req.path.split("/").pop();
    if (req.method === "PUT") {
      const data = JSON.parse(req.body.toString("utf8") || "{}");
      items.set(id, { ...data, id });
      return res.json(200, items.get(id));
    }
    if (req.method === "DELETE") { items.delete(id); return res.send(204); }
    const item = items.get(id);
    return item ? res.json(200, item) : res.json(404, { error: "Not Found" });
  }

  if (req.path === "/api/hello") {
    return res.json(200, {
      message: "バックエンドAPIからの応答です",
      注意: "このAPIは Access-Control-* を1つも返していません",
    });
  }

  res.json(404, { error: "Not Found", path: req.path });
}, "[バックエンド 9001]").listen(BACKEND_PORT, BACKEND_HOST);

// ============================================================
// (2) リバースプロキシ ― サーバがTCPクライアントになる
// ============================================================

// 転送してはいけないヘッダー（ホップバイホップヘッダー）。
// これらは「この1本の接続についての取り決め」なので、
// 次の接続にそのまま持ち越してはいけない。
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

/** バックエンドから返ってきた生のHTTPレスポンスを分解する */
function parseResponse(buf) {
  const headerEnd = buf.indexOf("\r\n\r\n");
  if (headerEnd === -1) return null;

  const lines = buf.subarray(0, headerEnd).toString("utf8").split("\r\n");
  const status = Number(lines[0].split(" ")[1]) || 502;

  // 同名ヘッダー（Set-Cookie など）を潰さないよう配列で持つ
  const headers = new Map();
  for (const line of lines.slice(1)) {
    const c = line.indexOf(":");
    if (c === -1) continue;
    const name = line.slice(0, c).trim();
    const value = line.slice(c + 1).trim();
    const key = name.toLowerCase();
    if (headers.has(key)) headers.get(key).values.push(value);
    else headers.set(key, { name, values: [value] });
  }

  return { status, headers, body: buf.subarray(headerEnd + 4) };
}

function proxyToBackend(req, res) {
  // --- バックエンドへ送るリクエストを組み立てる ---------------
  const outHeaders = [];
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name)) continue;
    if (name === "host") continue;           // Hostは付け替える
    if (name === "content-length") continue; // 自分で計算し直す
    outHeaders.push(`${name}: ${value}`);
  }

  // Hostは転送先のものに書き換える。
  // バックエンドが「自分は何というホスト名で呼ばれたか」を知るために、
  // 元の情報は X-Forwarded-* で渡すのが慣習。
  outHeaders.push(`Host: ${BACKEND_HOST}:${BACKEND_PORT}`);
  outHeaders.push(`X-Forwarded-Host: ${req.headers["host"] ?? ""}`);
  outHeaders.push(`X-Forwarded-Proto: http`);
  outHeaders.push(`X-Forwarded-For: 127.0.0.1`);
  outHeaders.push(`Content-Length: ${req.body.length}`);
  // 応答の終わりを「接続が閉じたとき」で判定できるようにする。
  // （学習用の単純化。実務のプロキシはkeep-aliveを維持する）
  outHeaders.push(`Connection: close`);

  const upstreamRequest = Buffer.concat([
    Buffer.from(`${req.method} ${req.target} HTTP/1.1\r\n${outHeaders.join("\r\n")}\r\n\r\n`, "utf8"),
    req.body,
  ]);

  // --- 自分がTCPクライアントになって接続する -------------------
  const upstream = net.createConnection({ host: BACKEND_HOST, port: BACKEND_PORT }, () => {
    dump("▶ プロキシ → バックエンド", C.yellow, upstreamRequest);
    upstream.write(upstreamRequest);
  });

  let received = Buffer.alloc(0);
  upstream.on("data", (chunk) => { received = Buffer.concat([received, chunk]); });

  upstream.on("end", () => {
    dump("◀ バックエンド → プロキシ", C.yellow, received);

    const parsed = parseResponse(received);
    if (!parsed) return res.json(502, { error: "バックエンドの応答が壊れています" });

    // --- ブラウザへ返すヘッダーを組み立てる -------------------
    const headers = {};
    for (const [key, { name, values }] of parsed.headers) {
      if (HOP_BY_HOP.has(key)) continue;      // 転送しない
      if (key === "content-length") continue; // 自分で付け直す
      headers[name] = values.length === 1 ? values[0] : values;
    }

    // ここが要点:
    // Access-Control-* を足す必要がまったくない。
    // ブラウザから見れば、これは 8080 自身が返した同一オリジンの応答だから。
    res.send(parsed.status, headers, parsed.body);
  });

  upstream.on("error", (err) => {
    console.log(`${C.red}バックエンドに接続できません: ${err.message}${C.reset}`);
    res.json(502, { error: "Bad Gateway", detail: err.message });
  });
}

createHttpServer((req, res) => {
  console.log(`${C.bold}[プロキシ 8080] ${req.method} ${req.path}${C.reset}`);

  // /api/ で始まるものだけを裏へ流す。それ以外は自分で返す。
  if (req.path.startsWith("/api/")) return proxyToBackend(req, res);

  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[プロキシ 8080]").listen(PORT_PROXY, () => {
  console.log("============================================");
  console.log(" step19（特別演習）: 同一オリジン化リバースプロキシ");
  console.log("============================================");
  console.log(` ブラウザが見るオリジン : http://localhost:${PORT_PROXY}`);
  console.log(` 裏のバックエンドAPI    : http://${BACKEND_HOST}:${BACKEND_PORT}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PROXY}/ を開いてください`);
  console.log("");
  console.log(" 1リクエストにつき4つのダンプが出ます:");
  console.log("   ▼ ブラウザ    → プロキシ");
  console.log("   ▶ プロキシ    → バックエンド   ← Hostが書き換わっている");
  console.log("   ◀ バックエンド → プロキシ");
  console.log("   ▲ プロキシ    → ブラウザ");
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step19: 同一オリジン化リバースプロキシ</title>
<style>
 body{font-family:sans-serif;max-width:54em;margin:2em auto;line-height:1.8;padding:0 1em}
 button{font-size:.95em;padding:.5em 1em;margin:.2em 0;display:block;width:100%;text-align:left}
 .log{background:#111;color:#eee;padding:1em;border-radius:6px;white-space:pre-wrap;
      font-family:monospace;font-size:13px;min-height:8em}
 .ok{color:#4ade80} .ng{color:#f87171} .hint{color:#fbbf24}
 code{background:#eee;padding:1px 4px;border-radius:3px}
 pre{background:#f6f8fa;padding:1em;border-radius:6px;overflow-x:auto;font-size:13px}
 table{border-collapse:collapse;width:100%;margin:1em 0}
 th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;vertical-align:top} th{background:#f3f4f6}
</style>
<body>
<h1>step19: 同一オリジン化リバースプロキシ</h1>

<pre>ブラウザ ──→ http://localhost:8080   ページ＋プロキシ（＝唯一のオリジン）
                    │  /api/* だけを転送
                    ↓
              http://127.0.0.1:9001   バックエンドAPI（CORS設定は一切なし）</pre>

<h2>1. 直接叩く vs プロキシ経由</h2>
<button onclick="direct()">
  ① 直接　http://localhost:9001/api/hello　… 別オリジン</button>
<button onclick="viaProxy('/api/hello')">
  ② プロキシ経由　/api/hello　… 同一オリジン</button>

<h2>2. プリフライトが飛ばないことを確かめる</h2>
<button onclick="viaProxy('/api/items/1','PUT',true)">
  ③ PUT /api/items/1　Content-Type: application/json</button>
<button onclick="viaProxy('/api/items/1','DELETE',false)">
  ④ DELETE /api/items/1</button>
<p>step14 なら確実にプリフライトが飛んだ組み合わせです。
サーバのコンソールに <code>OPTIONS</code> が<strong>1つも出ない</strong>ことを確認してください。</p>

<h2>3. Cookieが素直に動くことを確かめる</h2>
<button onclick="viaProxy('/api/login','POST',true)">⑤ POST /api/login</button>
<button onclick="viaProxy('/api/me')">⑥ GET /api/me</button>
<p><code>credentials: 'include'</code> を<strong>一度も書いていません</strong>。
同一オリジンなので既定でCookieが送られます。<br>
DevTools → Application → Cookies を見ると、Cookieは
<code>http://localhost:8080</code> のものとして保存されています。
バックエンドが発行したのに、です。</p>

<h2>結果</h2>
<div class="log" id="log">ボタンを押してください</div>

<h2>2つの解の比較</h2>
<table>
<tr><th></th><th>CORSを設定する（step13〜18）</th><th>プロキシで同一オリジンにする（step19）</th></tr>
<tr><td>ブラウザから見たオリジン</td><td>2つ</td><td>1つ</td></tr>
<tr><td>プリフライト</td><td>条件次第で飛ぶ（往復1回分の遅延）</td><td>飛ばない</td></tr>
<tr><td>Cookie</td><td><code>SameSite=None; Secure</code> ＋
    <code>credentials:'include'</code> ＋ <code>Allow-Credentials</code> が必要</td>
    <td>ファーストパーティCookieとして普通に動く</td></tr>
<tr><td>APIの改修</td><td>必要（CORSヘッダーを返す）</td><td>不要</td></tr>
<tr><td>運用</td><td>サーバは1つでよい</td><td>プロキシ層が増える。障害点も増える</td></tr>
<tr><td>向いている場面</td><td>不特定多数に公開するAPI、<br>別会社のフロントから叩かれるAPI</td>
    <td>自社フロント＋自社API、<br>APIを改修できない場合</td></tr>
</table>

<p>Vite や Next.js の開発サーバにある <code>proxy</code> 設定、
Nginx の <code>location /api/ { proxy_pass ...; }</code>、
Kubernetes の Ingress —— すべて今作ったものと同じ発想です。</p>

<h2>プロキシを書くときの注意</h2>
<ul>
<li><strong>転送先を固定する</strong>。URLの一部を転送先ホストにするような作りにすると、
    社内ネットワークへの踏み台（SSRF）になります</li>
<li><strong>ホップバイホップヘッダーを転送しない</strong>
    （<code>Connection</code>, <code>Transfer-Encoding</code>, <code>Upgrade</code> など）</li>
<li><strong><code>Host</code> を書き換え、元の情報は <code>X-Forwarded-*</code> で渡す</strong></li>
<li>クライアントが送ってきた <code>X-Forwarded-For</code> を<strong>信用しない</strong>
    （偽装できます。自分で上書きするか、信頼できる範囲だけ追記する）</li>
<li>この実装は <code>Transfer-Encoding: chunked</code> やWebSocketに対応していません</li>
</ul>

<script>
var logEl = document.getElementById('log');
function log(msg, cls) {
  var s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = msg + '\\n';
  logEl.appendChild(s);
}
function clear() { logEl.textContent = ''; }

async function direct() {
  clear();
  log('fetch("http://localhost:9001/api/hello")');
  log('（ページは localhost:8080。ポートが違うので別オリジン）');
  log('');
  try {
    var r = await fetch('http://localhost:9001/api/hello');
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
  } catch (e) {
    log('失敗: ' + e, 'ng');
    log('');
    log('バックエンドは Access-Control-* を1つも返していないので、', 'hint');
    log('step12 とまったく同じ理由でブロックされます。', 'hint');
    log('サーバのコンソールを見れば、リクエスト自体は届いています。', 'hint');
  }
}

async function viaProxy(path, method, withBody) {
  clear();
  log('fetch("' + path + '")   ← 相対パス。つまり同一オリジン');
  if (method) log('method: ' + method);
  log('');
  try {
    var init = {};
    if (method) init.method = method;
    // ボディはここで組み立てる。
    // onclick属性の中にJSONを書くと、" がHTML属性を途中で終端してしまう。
    if (withBody) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify({ name: 'メロン', price: 3000 });
    }
    var r = await fetch(path, init);
    log('成功 status=' + r.status, 'ok');
    var t = await r.text();
    log(t || '(ボディなし)', 'ok');
    log('');
    log('サーバのコンソールで4つのダンプを確認してください。', 'hint');
    log('  ▼ ブラウザ    → プロキシ', 'hint');
    log('  ▶ プロキシ    → バックエンド  ← Host が 127.0.0.1:9001 に', 'hint');
    log('  ◀ バックエンド → プロキシ', 'hint');
    log('  ▲ プロキシ    → ブラウザ', 'hint');
    log('');
    log('バックエンドのログで Origin を見てください。', 'hint');
    log('GET では付きません。POST/PUT/DELETE では同一オリジンでも', 'hint');
    log('ブラウザが Origin を付けるので、それがそのまま転送されます。', 'hint');
    log('ただしバックエンドはCORS判定をしていないので、何も起きません。', 'hint');
  } catch (e) {
    log('失敗: ' + e, 'ng');
  }
}
</script>
</body></html>
`;
