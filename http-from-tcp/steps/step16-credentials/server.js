// ============================================================
// step16: credentials とクロスオリジンの Cookie
//
// step15 との差分:
//   - fetch の credentials: 'include' を扱う
//   - Access-Control-Allow-Credentials: true
//   - このとき Access-Control-Allow-Origin に * は使えない
//     → Origin をそのまま返す（＋ Vary: Origin）
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

const PORT_PAGE = 8080;
const PORT_API = 8081;

// 許可するオリジン。credentials を使う場合、* は使えないので
// 「許可リストに載っていたら、その Origin をそのまま返す」形にする。
const ALLOWED_ORIGINS = new Set(["http://localhost:8080"]);

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

/**
 * credentials 付きリクエストに返すべきCORSヘッダーを作る。
 *
 * 重要な3点:
 *   1. Access-Control-Allow-Origin に "*" は使えない。
 *      ブラウザが明確に拒否する。Origin をそのまま返すしかない。
 *   2. Access-Control-Allow-Credentials: true が必要。
 *   3. 応答内容が Origin によって変わるので Vary: Origin を付ける。
 *      これが無いと、CDNやプロキシが
 *      「A社向けの応答」をB社に配ってしまう事故が起きる。
 */
function corsWithCredentials(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": origin, // ← "*" ではない
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

createHttpServer((req, res) => {
  const origin = req.headers["origin"];
  const cookies = parseCookie(req.headers["cookie"]);
  const session = cookies.sid ? sessions.get(cookies.sid) : undefined;

  console.log(
    `${C.bold}[API 8081] ${req.method} ${req.path}${C.reset}` +
    `  Origin: ${origin ?? "(無し)"}`
  );
  console.log(
    `    Cookie ヘッダー : ${req.headers["cookie"]
      ? C.green + req.headers["cookie"] + C.reset
      : C.red + "届いていません" + C.reset}`
  );

  // ── プリフライト ─────────────────────────────────────────
  if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
    console.log(`  ${C.yellow}★ プリフライト${C.reset}`);

    // 本番が credentials 付きなら、プリフライトの応答にも
    // Access-Control-Allow-Credentials: true が必要。
    // ここを忘れるのが実務で一番多いミス。
    return res.send(204, {
      ...corsWithCredentials(origin),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "30",
    });
  }

  // ── ログイン（Cookieを発行する） ──────────────────────────
  if (req.path === "/api/login" || req.path === "/api/login-samesite-none") {
    let user = "ゲスト";
    try { user = JSON.parse(req.body.toString("utf8")).user || user; } catch {}

    const sid = randomUUID();
    sessions.set(sid, { user, loginAt: new Date().toISOString() });

    // SameSite の違いが今回のもうひとつの見どころ（発展編で使う）
    const sameSite = req.path === "/api/login-samesite-none"
      ? "SameSite=None; Secure" // クロスサイトでも送られる。Secure が必須
      : "SameSite=Lax";         // クロスサイトでは送られない（既定）

    console.log(`  ${C.green}ログイン: ${user} / ${sameSite}${C.reset}`);

    return res.json(200, { ok: true, user, sameSite },
      { ...corsWithCredentials(origin), "Set-Cookie": `sid=${sid}; Path=/; HttpOnly; ${sameSite}` });
  }

  // ── ログアウト ───────────────────────────────────────────
  if (req.path === "/api/logout") {
    if (cookies.sid) sessions.delete(cookies.sid);
    return res.json(200, { ok: true },
      { ...corsWithCredentials(origin), "Set-Cookie": "sid=; Path=/; HttpOnly; Max-Age=0" });
  }

  // ── 本人確認（Cookieが届いているかで結果が変わる） ─────────
  if (req.path === "/api/me") {
    return res.json(200, {
      ログイン中: Boolean(session),
      ユーザー: session ? session.user : null,
      サーバが受け取ったCookie: req.headers["cookie"] ?? "(無し)",
    }, corsWithCredentials(origin));
  }

  // ── わざと * を返す版（credentials と両立しない） ──────────
  if (req.path === "/api/me-wildcard") {
    console.log(`  ${C.red}→ Access-Control-Allow-Origin: * を返します（credentialsとは両立しません）${C.reset}`);
    return res.json(200, {
      ログイン中: Boolean(session),
      サーバが受け取ったCookie: req.headers["cookie"] ?? "(無し)",
    }, { "Access-Control-Allow-Origin": "*" });
  }

  // ── Allow-Credentials を付け忘れた版 ──────────────────────
  if (req.path === "/api/me-no-allow-credentials") {
    console.log(`  ${C.red}→ Allow-Credentials を付け忘れた応答を返します${C.reset}`);
    return res.json(200, {
      ログイン中: Boolean(session),
      サーバが受け取ったCookie: req.headers["cookie"] ?? "(無し)",
    }, { "Access-Control-Allow-Origin": origin ?? "*", "Vary": "Origin" });
  }

  res.json(404, { error: "Not Found" }, corsWithCredentials(origin));
}, "[API 8081]").listen(PORT_API);

createHttpServer((req, res) => {
  if (req.path === "/") return res.html(200, PAGE);
  res.text(404, "Not Found\n");
}, "[ページ 8080]").listen(PORT_PAGE, () => {
  console.log("============================================");
  console.log(" step16: credentials とクロスオリジンの Cookie");
  console.log("============================================");
  console.log(` オリジンA（ページ）: http://localhost:${PORT_PAGE}`);
  console.log(` オリジンB（API）   : http://localhost:${PORT_API}`);
  console.log("");
  console.log(` ブラウザで http://localhost:${PORT_PAGE}/ を開いてください`);
  console.log(" ※ Cookieが届いたかどうかを毎回このコンソールに出します");
  console.log("");
  console.log(" 終了: Ctrl+C");
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step16: credentials</title>
<style>
 body{font-family:sans-serif;max-width:54em;margin:2em auto;line-height:1.8;padding:0 1em}
 button{font-size:.95em;padding:.5em 1em;margin:.2em 0;display:block;width:100%;text-align:left}
 .log{background:#111;color:#eee;padding:1em;border-radius:6px;white-space:pre-wrap;
      font-family:monospace;font-size:13px;min-height:8em}
 .ok{color:#4ade80} .ng{color:#f87171} .hint{color:#fbbf24}
 code{background:#eee;padding:1px 4px;border-radius:3px}
 .adv{background:#f0f9ff;border-left:4px solid #0284c7;padding:1em 1.2em;border-radius:4px}
 table{border-collapse:collapse;width:100%;margin:1em 0}
 th,td{border:1px solid #ccc;padding:6px 10px;text-align:left} th{background:#f3f4f6}
</style>
<body>
<h1>step16: credentials とクロスオリジンの Cookie</h1>
<p>ページ: <strong id="origin"></strong>　／　API: <strong>http://localhost:8081</strong></p>

<p><code>fetch</code> は<strong>既定でCookieを送りません</strong>。
同一オリジンなら送りますが、クロスオリジンでは明示しない限り送られません。</p>

<h2>1. ログイン（Cookieを受け取る）</h2>
<button onclick="login()">POST /api/login　credentials: 'include'</button>

<h2>2. Cookieが送られるかを比べる</h2>
<button onclick="me('omit')">
  ① GET /api/me　credentials 指定なし（＝'same-origin'）</button>
<button onclick="me('include')">
  ② GET /api/me　credentials: 'include'</button>

<h2>3. サーバ側の設定ミスを再現する</h2>
<button onclick="me('include','/api/me-wildcard')">
  ③ Access-Control-Allow-Origin: <b>*</b> ＋ credentials: 'include'</button>
<button onclick="me('include','/api/me-no-allow-credentials')">
  ④ Allow-Credentials を付け忘れた応答 ＋ credentials: 'include'</button>

<h2>4. ログアウト</h2>
<button onclick="logout()">POST /api/logout</button>

<h2>結果</h2>
<div class="log" id="log">ボタンを押してください</div>

<h2>まとめ</h2>
<table>
<tr><th>credentials</th><th>意味</th></tr>
<tr><td><code>'omit'</code></td><td>絶対に送らない</td></tr>
<tr><td><code>'same-origin'</code>（既定）</td><td>同一オリジンのときだけ送る</td></tr>
<tr><td><code>'include'</code></td><td>クロスオリジンでも送る。サーバ側の許可が必要</td></tr>
</table>

<p><strong>credentials: 'include' を使うときのサーバ側の条件（全部必要）</strong></p>
<ul>
<li><code>Access-Control-Allow-Origin</code> に <code>*</code> は<strong>使えない</strong>。
    Origin をそのまま返す</li>
<li><code>Access-Control-Allow-Credentials: true</code> を返す</li>
<li>プリフライトが飛ぶ場合は、<strong>プリフライトの応答にも</strong>この2つが必要</li>
<li><code>Vary: Origin</code> を付ける（キャッシュ事故を防ぐ）</li>
</ul>

<p><code>*</code> が禁止されている理由: <code>*</code> は「誰でもどうぞ」という意味です。
そこにユーザーのCookie（＝本人の権限）が乗ると、
<strong>どんなサイトからでも、そのユーザーとしてAPIを叩いて結果を読める</strong>ことになります。
だから「誰でも」と「本人の権限」は同時に成立させてはいけないのです。</p>

<h2 style="margin-top:3em">発展（任意）: オリジンとサイトは別物</h2>
<div class="adv">
<p><code>http://localhost:8080</code> と <code>http://localhost:8081</code> は
<strong>別オリジン</strong>ですが、<strong>同じサイト</strong>です。
サイトの判定にポート番号は関係ありません。<br>
だからここまでの実験では <code>SameSite=Lax</code> のままCookieが送られていました。</p>

<p><code>http://127.0.0.1:8081</code> にすると、<strong>別サイト</strong>になります
（ホスト名が違うため）。同じAPIサーバに別の名前でアクセスするだけで、
Cookieの扱いが変わります。</p>

<button onclick="cross('/api/login')">
  ⑤ 127.0.0.1 側に SameSite=Lax でログイン</button>
<button onclick="cross('/api/me')">
  ⑥ 127.0.0.1 側の /api/me を credentials:'include' で呼ぶ</button>
<button onclick="cross('/api/login-samesite-none')">
  ⑦ 127.0.0.1 側に SameSite=None; Secure でログインし直す</button>
<p style="margin-bottom:0">⑤→⑥ ではCookieが届かず、⑦→⑥ では届きます。<br>
<small>※ うまくいかない場合は、ブラウザのサードパーティCookieブロックを確認してください
（Chrome: 設定 → プライバシー → サードパーティCookie / Safari は既定でブロック）。</small></p>
</div>

<script>
document.getElementById('origin').textContent = location.origin;
var API = 'http://localhost:8081';
var API_CROSS_SITE = 'http://127.0.0.1:8081';
var logEl = document.getElementById('log');
function log(msg, cls) {
  var s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = msg + '\\n';
  logEl.appendChild(s);
}
function clear() { logEl.textContent = ''; }

async function login() {
  clear();
  log("POST /api/login  credentials: 'include'");
  try {
    var r = await fetch(API + '/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: '山田' })
    });
    log('成功 status=' + r.status, 'ok');
    log(await r.text(), 'ok');
    log('');
    log('Set-Cookie を受け入れるにも credentials: "include" が必要です。', 'hint');
    log('省くとブラウザはCookieを保存しません。', 'hint');
    log('DevTools → Application → Cookies → http://localhost:8081 を見てください。', 'hint');
  } catch (e) { log('失敗: ' + e, 'ng'); }
}

async function me(mode, path) {
  clear();
  path = path || '/api/me';
  log('GET ' + path + "  credentials: '" + (mode === 'include' ? 'include' : '既定') + "'");
  try {
    var init = {};
    if (mode === 'include') init.credentials = 'include';
    var r = await fetch(API + path, init);
    var text = await r.text();
    log('成功 status=' + r.status, 'ok');
    log(text, 'ok');
    log('');
    if (mode !== 'include') {
      log('ログイン中が false のはずです。', 'hint');
      log('通信自体は成功していますが、Cookieが送られていません。', 'hint');
      log('サーバのコンソールでも「届いていません」と出ています。', 'hint');
    } else {
      log('Cookieが届き、ログイン中として扱われました。', 'hint');
    }
  } catch (e) {
    log('失敗: ' + e, 'ng');
    log('');
    if (path === '/api/me-wildcard') {
      log('→ サーバは Access-Control-Allow-Origin: * を返しました。', 'hint');
      log('  credentials 付きのときブラウザは * を受け付けません。', 'hint');
      log('  Origin をそのまま返す必要があります。', 'hint');
    } else if (path === '/api/me-no-allow-credentials') {
      log('→ Origin は正しく返っていますが、', 'hint');
      log('  Access-Control-Allow-Credentials: true がありません。', 'hint');
      log('  Origin の一致だけでは足りず、明示的な許可が要ります。', 'hint');
    }
    log('DevTools の Console に具体的な理由が出ています。読んでみてください。');
  }
}

async function logout() {
  clear();
  var r = await fetch(API + '/api/logout', { method: 'POST', credentials: 'include' });
  log('ログアウトしました status=' + r.status, 'ok');
  log(await r.text(), 'ok');
}

async function cross(path) {
  clear();
  log((path === '/api/me' ? 'GET ' : 'POST ') + API_CROSS_SITE + path);
  log('（127.0.0.1 なので、このページとは別サイト扱いになります）');
  log('');
  try {
    var init = { credentials: 'include' };
    if (path !== '/api/me') {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify({ user: 'クロスサイト太郎' });
    }
    var r = await fetch(API_CROSS_SITE + path, init);
    var text = await r.text();
    log('status=' + r.status, 'ok');
    log(text, 'ok');
    log('');
    if (path === '/api/login') {
      log('応答は成功していますが、Set-Cookie は SameSite=Lax です。', 'hint');
      log('別サイトからのfetchなので、ブラウザはこのCookieを保存しません。', 'hint');
      log('DevTools → Application → Cookies → http://127.0.0.1:8081 が空か確認を。', 'hint');
    } else if (path === '/api/login-samesite-none') {
      log('今度は SameSite=None; Secure なので保存されます。', 'hint');
      log('（localhost / 127.0.0.1 は例外的に安全なオリジン扱いなので', 'hint');
      log('  http でも Secure Cookie が使えます）', 'hint');
      log('このあと ⑥ をもう一度押してください。', 'hint');
    } else {
      log('サーバのコンソールの「Cookie ヘッダー」を見てください。', 'hint');
      log('SameSite=Lax のままなら届かず、None なら届きます。', 'hint');
    }
  } catch (e) {
    log('失敗: ' + e, 'ng');
    log('ALLOWED_ORIGINS に載っているのは http://localhost:8080 だけです。', 'hint');
    log('（このページのオリジンは変わらないので、通常は成功します）', 'hint');
  }
}
</script>
</body></html>
`;
