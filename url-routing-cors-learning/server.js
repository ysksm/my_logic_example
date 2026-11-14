// =============================================================
// URL / ルーティング / CORS 学習用サーバー（依存パッケージなし）
//
//   node server.js
//
// 2 つのサーバーを同時に起動します。
//
//   ┌──────────────────────────────┐        ┌──────────────────────────────┐
//   │ APP サーバー  :3000          │ fetch  │ API サーバー  :4000          │
//   │  - 静的ファイル (各 step)    │ ─────▶ │  - CORS のデモ用エンドポイント│
//   │  - サーバーサイドルーティング│        │  - 受信リクエストのログ      │
//   │  - History API 用フォールバック│      │                              │
//   └──────────────────────────────┘        └──────────────────────────────┘
//
// ポートが違う = オリジンが違う ので、:3000 のページから :4000 を fetch すると
// 「クロスオリジン通信」になり CORS のルールが適用されます。
//
// ポートは環境変数で変更できます:  APP_PORT=3100 API_PORT=4100 node server.js
// =============================================================

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1"; // 外部には公開しない
const APP_PORT = Number(process.env.APP_PORT || 3000);
const API_PORT = Number(process.env.API_PORT || 4000);
const ROOT = __dirname;

// API サーバーが「通信を許可する」オリジンのリスト（許可リスト方式）。
// localhost と 127.0.0.1 は文字列が違うので「別オリジン」扱いになる点に注意。
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${APP_PORT}`,
  `http://127.0.0.1:${APP_PORT}`,
]);

// -------------------------------------------------------------
// 共通ユーティリティ
// -------------------------------------------------------------

// HTML に埋め込む文字列は必ずエスケープする（XSS 対策）
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ROOT 配下のファイルだけを返す。見つかったら true。
function tryServeStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  // ../ を使って ROOT の外を読もうとするリクエストを拒否
  if (!filePath.startsWith(ROOT + path.sep)) return false;
  if (path.basename(filePath) === "server.js") return false;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (stat.isDirectory()) {
    // /step01-url-anatomy → /step01-url-anatomy/ にリダイレクト
    res.writeHead(301, { Location: pathname + "/" });
    res.end();
    return true;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// =============================================================
// APP サーバー (:3000)
// =============================================================

let appRequestCount = 0;

// --- STEP 3: サーバーサイドルーティング ------------------------
// 「パス文字列」と「処理する関数」の対応表 = ルーティングテーブル。
// :id のような部分はパラメーターとして取り出す。
const ITEMS = {
  1: { name: "りんご", price: 120 },
  2: { name: "バナナ", price: 80 },
  3: { name: "みかん", price: 60 },
};

const serverRoutes = [
  { method: "GET", pattern: "/server", handler: serverHome },
  { method: "GET", pattern: "/server/items", handler: serverItemList },
  { method: "GET", pattern: "/server/items/:id", handler: serverItemDetail },
  { method: "GET", pattern: "/server/search", handler: serverSearch },
];

// "/server/items/:id" と "/server/items/2" を照合して { id: "2" } を返す
function matchRoute(pattern, pathname) {
  const p = pattern.split("/").filter(Boolean);
  const a = pathname.split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

function serverPage(req, url, title, bodyHtml) {
  // サーバーが受け取ったリクエスト情報をそのまま表示する（学習用）
  const query = Object.fromEntries(url.searchParams);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} | サーバーサイドルーティング</title>
<link rel="stylesheet" href="/common.css">
</head>
<body>
<header class="page-header">
  <a href="/step03-server-routing/" class="back">← STEP 3 の解説に戻る</a>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">この HTML は <b>サーバー (server.js) がリクエストのたびに生成</b> しています</p>
</header>
<main>
  <nav class="route-nav">
    <a href="/server">/server</a>
    <a href="/server/items">/server/items</a>
    <a href="/server/items/1">/server/items/1</a>
    <a href="/server/items/2">/server/items/2</a>
    <a href="/server/search?q=りんご">/server/search?q=りんご</a>
    <a href="/server/unknown">/server/unknown (404)</a>
  </nav>
  <section class="card">${bodyHtml}</section>
  <section class="card">
    <h2>サーバーが受け取ったリクエスト</h2>
    <table class="kv">
      <tr><th>method</th><td><code>${escapeHtml(req.method)}</code></td></tr>
      <tr><th>pathname</th><td><code>${escapeHtml(url.pathname)}</code></td></tr>
      <tr><th>query</th><td><code>${escapeHtml(JSON.stringify(query))}</code></td></tr>
      <tr><th>生成時刻</th><td><code>${new Date().toLocaleTimeString("ja-JP")}</code></td></tr>
      <tr><th>サーバーの通算リクエスト数</th><td><code>${appRequestCount}</code></td></tr>
    </table>
    <p class="hint">リンクをクリックするたびに「生成時刻」が変わる = 毎回ページ全体をサーバーから取り直している（フルリロード）。DevTools の Network タブで Type が <code>document</code> のリクエストを確認してみましょう。</p>
  </section>
</main>
</body>
</html>`;
}

function serverHome(req, res, url) {
  sendHtml(res, 200, serverPage(req, url, "ホーム (/server)", `
    <h2>ようこそ</h2>
    <p>上のリンクはすべて普通の <code>&lt;a href&gt;</code> です。JavaScript は使っていません。</p>`));
}

function serverItemList(req, res, url) {
  const rows = Object.entries(ITEMS)
    .map(([id, it]) => `<li><a href="/server/items/${id}">${escapeHtml(it.name)}</a> … ${it.price} 円</li>`)
    .join("");
  sendHtml(res, 200, serverPage(req, url, "商品一覧 (/server/items)", `<h2>商品一覧</h2><ul>${rows}</ul>`));
}

function serverItemDetail(req, res, url, params) {
  const item = ITEMS[params.id];
  if (!item) return serverNotFound(req, res, url);
  sendHtml(res, 200, serverPage(req, url, `商品詳細 (/server/items/${params.id})`, `
    <h2>${escapeHtml(item.name)}</h2>
    <p>価格: ${item.price} 円</p>
    <p class="hint">ルート定義 <code>/server/items/:id</code> にマッチし、<code>params.id = "${escapeHtml(params.id)}"</code> として取り出されました。</p>`));
}

function serverSearch(req, res, url) {
  // クエリパラメーターはサーバー側でも url.searchParams で読める
  const q = url.searchParams.get("q") || "";
  const hits = Object.entries(ITEMS).filter(([, it]) => q && it.name.includes(q));
  const list = hits.length
    ? `<ul>${hits.map(([id, it]) => `<li><a href="/server/items/${id}">${escapeHtml(it.name)}</a></li>`).join("")}</ul>`
    : "<p>該当なし</p>";
  sendHtml(res, 200, serverPage(req, url, "検索 (/server/search)", `
    <h2>「${escapeHtml(q)}」の検索結果</h2>
    <form action="/server/search" method="get">
      <input name="q" value="${escapeHtml(q)}" placeholder="例: みかん">
      <button>検索</button>
    </form>
    ${list}
    <p class="hint">form の method="get" は入力値を <code>?q=...</code> としてURLに付けて送ります。</p>`));
}

function serverNotFound(req, res, url) {
  sendHtml(res, 404, serverPage(req, url, "404 Not Found", `
    <h2>ページが見つかりません</h2>
    <p>どのルートにもマッチしなかったので、サーバーは <b>ステータスコード 404</b> を返しました。</p>`));
}

// --- STEP 5: History API ルーティング用のフォールバック ---------
// /step05-history-routing/app/ 以下のどんなパスに来ても、同じ index.html を返す。
// これがないと、/step05-history-routing/app/users/42 でリロードしたときに 404 になる。
const SPA_PREFIX = "/step05-history-routing/app/";
const SPA_INDEX = path.join(ROOT, "step05-history-routing", "index.html");

const appServer = http.createServer((req, res) => {
  try {
    handleApp(req, res);
  } catch (err) {
    // "/server/items/%" のような壊れた URL は decodeURIComponent が例外を投げる
    if (err instanceof URIError) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("400 Bad Request: URL のエンコードが不正です");
    }
    throw err;
  }
});

function handleApp(req, res) {
  appRequestCount++;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  console.log(`[app ] ${req.method} ${req.url}`);

  // ⓪ ページ側に API サーバーのポートを教える（STEP 6, 7 で使用）
  if (pathname === "/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    // ページと同じホスト名を使う（localhost で開いたら localhost:4000）
    return res.end(`window.API_ORIGIN = location.protocol + "//" + location.hostname + ":${API_PORT}";\n`);
  }

  // ① 同一オリジン API（STEP 6 で使用）
  if (pathname === "/api/hello") {
    return sendJson(res, 200, { message: "同一オリジンの API です", servedBy: `:${APP_PORT}` });
  }

  // ② サーバーサイドルーティング（STEP 3）
  if (pathname === "/server" || pathname.startsWith("/server/")) {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    for (const r of serverRoutes) {
      if (r.method !== req.method) continue;
      const params = matchRoute(r.pattern, normalized);
      if (params) return r.handler(req, res, url, params);
    }
    return serverNotFound(req, res, url);
  }

  // ③ 静的ファイル
  if (tryServeStatic(req, res, pathname)) return;

  // ④ SPA フォールバック（STEP 5）: 静的ファイルが無ければ index.html を返す
  if (pathname === SPA_PREFIX.slice(0, -1) || pathname.startsWith(SPA_PREFIX)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return fs.createReadStream(SPA_INDEX).pipe(res);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`404 Not Found: ${pathname}`);
}

// =============================================================
// API サーバー (:4000)  ── CORS のデモ
// =============================================================

// 受け取ったリクエストを記録して、ブラウザ側から見られるようにする。
// 「CORS エラーになってもリクエスト自体はサーバーに届いている」ことを確認するため。
const requestLog = [];
function logApi(req, pathname, responseCors) {
  requestLog.unshift({
    time: new Date().toLocaleTimeString("ja-JP", { hour12: false }) + "." + String(Date.now() % 1000).padStart(3, "0"),
    method: req.method,
    path: pathname,
    origin: req.headers.origin || "(なし)",
    requestHeaders: {
      "access-control-request-method": req.headers["access-control-request-method"],
      "access-control-request-headers": req.headers["access-control-request-headers"],
      "content-type": req.headers["content-type"],
      "x-demo-token": req.headers["x-demo-token"],
      cookie: req.headers.cookie,
    },
    responseCors,
  });
  requestLog.length = Math.min(requestLog.length, 50);
}

// リクエストの Origin が許可リストにあれば、そのオリジンを返す
function allowedOrigin(req) {
  const origin = req.headers.origin;
  return origin && ALLOWED_ORIGINS.has(origin) ? origin : null;
}

// それぞれのエンドポイントが「どんな CORS ヘッダーを返すか」が学習ポイント。
// handler は { status, headers, body } を返す。
const apiRoutes = {
  // ---- 基本 ---------------------------------------------------
  // CORS ヘッダーを一切付けない → ブラウザがレスポンスを JS に渡さない
  "/basic/no-cors": () => ({
    status: 200,
    headers: {},
    body: { secret: "このデータは JS からは読めません" },
  }),

  // どのオリジンからでも読める（公開 API 向け）
  "/basic/wildcard": () => ({
    status: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: { message: "Access-Control-Allow-Origin: * なので誰でも読めます" },
  }),

  // 許可リストにあるオリジンだけ読める
  "/basic/allowlist": (req) => {
    const origin = allowedOrigin(req);
    return {
      status: 200,
      headers: origin
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : { Vary: "Origin" },
      body: { message: `許可されたオリジン ${origin} からのリクエストです` },
    };
  },

  // ---- 応用: プリフライト ----------------------------------------
  // PUT / DELETE / JSON / 独自ヘッダーを許可する（OPTIONS に正しく答える）
  "/advanced/preflight-ok": (req) => {
    const origin = allowedOrigin(req);
    const cors = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    if (req.method === "OPTIONS") {
      return {
        status: 204,
        headers: origin
          ? {
              ...cors,
              "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
              "Access-Control-Allow-Headers": "Content-Type, X-Demo-Token",
              // 学習用にプリフライトをキャッシュさせない（毎回 OPTIONS が見える）。本番では 600 などにする
              "Access-Control-Max-Age": "0",
            }
          : cors,
        body: null,
      };
    }
    return {
      status: 200,
      headers: cors,
      body: { message: `${req.method} を受け付けました`, receivedToken: req.headers["x-demo-token"] || null },
    };
  },

  // OPTIONS には答え PUT も許可するが、X-Demo-Token ヘッダーを許可しない → 本番リクエストが送られない
  "/advanced/preflight-ng": (req) => {
    const origin = allowedOrigin(req);
    const cors = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    if (req.method === "OPTIONS") {
      return {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, PUT", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "0" },
        body: null,
      };
    }
    return { status: 200, headers: cors, body: { message: "（ここには届かないはず）" } };
  },

  // ---- 応用: レスポンスヘッダーの公開 ------------------------------
  "/advanced/expose": (req) => {
    const origin = allowedOrigin(req);
    return {
      status: 200,
      headers: {
        ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
        Vary: "Origin",
        "X-Total-Count": "42",
        "X-Request-Id": "req-" + Math.random().toString(36).slice(2, 8),
        // X-Total-Count だけ JS に見せる。X-Request-Id は見せない。
        "Access-Control-Expose-Headers": "X-Total-Count",
      },
      body: { items: ["a", "b", "c"] },
    };
  },

  // ---- 応用: Cookie（credentials）--------------------------------
  "/advanced/login": (req) => {
    const origin = allowedOrigin(req);
    return {
      status: 200,
      headers: {
        ...(origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } : {}),
        Vary: "Origin",
        "Set-Cookie": `demo_session=user-${Math.floor(Math.random() * 1000)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      },
      body: { message: "Cookie demo_session をセットしました" },
    };
  },
  "/advanced/me": (req) => {
    const origin = allowedOrigin(req);
    const cookie = (req.headers.cookie || "").match(/demo_session=([^;]+)/);
    return {
      status: 200,
      headers: {
        ...(origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } : {}),
        Vary: "Origin",
      },
      body: { session: cookie ? cookie[1] : null },
    };
  },
  "/advanced/logout": (req) => {
    const origin = allowedOrigin(req);
    return {
      status: 200,
      headers: {
        ...(origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } : {}),
        Vary: "Origin",
        "Set-Cookie": "demo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      },
      body: { message: "Cookie を削除しました" },
    };
  },
  // よくある間違い: credentials 付きなのに Allow-Origin が * → ブラウザが拒否
  "/advanced/me-wildcard": (req) => {
    const cookie = (req.headers.cookie || "").match(/demo_session=([^;]+)/);
    return {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true" },
      body: { session: cookie ? cookie[1] : null },
    };
  },
};

const apiServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ログ閲覧用（学習用の補助 API。誰からでも読めるようにしておく）
  if (pathname === "/__log") {
    if (url.searchParams.get("clear") === "1") requestLog.length = 0;
    return sendJson(res, 200, requestLog, { "Access-Control-Allow-Origin": "*" });
  }

  console.log(`[api ] ${req.method} ${req.url}  Origin=${req.headers.origin || "-"}`);

  const route = apiRoutes[pathname];
  if (!route) {
    logApi(req, pathname, {});
    return sendJson(res, 404, { error: "not found" }, { "Access-Control-Allow-Origin": "*" });
  }

  const { status, headers, body } = route(req);
  const corsHeaders = Object.fromEntries(
    Object.entries(headers).filter(([k]) => k.toLowerCase().startsWith("access-control-") || k === "Vary"),
  );
  logApi(req, pathname, corsHeaders);

  if (body === null) {
    res.writeHead(status, headers);
    return res.end();
  }
  sendJson(res, status, body, headers);
});

// =============================================================
// 起動
// =============================================================
function listen(server, port, label) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n✖ ポート ${port} は使用中です (${label})。`);
      console.error(`  別のポートで起動: APP_PORT=3100 API_PORT=4100 node server.js\n`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
  server.listen(port, HOST);
}

listen(appServer, APP_PORT, "APP");
listen(apiServer, API_PORT, "API");

appServer.on("listening", () => {
  console.log(`APP サーバー: http://localhost:${APP_PORT}/   ← ブラウザでここを開く`);
});
apiServer.on("listening", () => {
  console.log(`API サーバー: http://localhost:${API_PORT}/   (CORS デモ用・別オリジン)`);
  console.log(`許可オリジン: ${[...ALLOWED_ORIGINS].join(", ")}`);
});
