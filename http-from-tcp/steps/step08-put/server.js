// ============================================================
// step08: PUT
//
// step07 との差分（HTTPコアは変更なし）:
//   - メモリ上のリソース置き場（Map）を用意
//   - POST /items      … 新規作成。呼ぶたび別のものが増える（冪等でない）
//   - PUT  /items/:id  … その場所を丸ごと置き換える（冪等）
//   - 201 Created と Location ヘッダー
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

/** リソース置き場。プロセスを再起動すると消えます。 */
const items = new Map();
let nextId = 1;

items.set("1", { id: "1", name: "りんご", price: 120 });
items.set("2", { id: "2", name: "みかん", price: 80 });
nextId = 3;

function parseJsonBody(req) {
  const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return { error: "Content-Type は application/json にしてください" };
  try {
    return { data: JSON.parse(req.body.toString("utf8")) };
  } catch (err) {
    return { error: "JSONとして壊れています: " + err.message };
  }
}

const server = createHttpServer((req, res) => {
  console.log(`${C.bold}${req.method} ${req.target}${C.reset}`);

  // --- トップページ -------------------------------------------
  if (req.path === "/" && req.method === "GET") {
    return res.html(200, PAGE);
  }

  // --- コレクション /items ------------------------------------
  if (req.path === "/items") {
    if (req.method === "GET") {
      return res.json(200, [...items.values()]);
    }

    if (req.method === "POST") {
      // POST は「このコレクションに新しいものを追加して」という依頼。
      // idはサーバが決める。だから同じリクエストを2回送ると2件できる。
      //   → 冪等ではない
      const { data, error } = parseJsonBody(req);
      if (error) return res.json(400, { error });

      const id = String(nextId++);
      const item = { id, ...data };
      items.set(id, item);

      console.log(`  ${C.yellow}新規作成: id=${id}（POSTなので毎回増える）${C.reset}`);

      // 201 Created のときは「どこに作られたか」を Location で伝えるのが作法。
      return res.json(201, item, { "Location": `/items/${id}` });
    }

    return res.text(405, "Method Not Allowed\n", { "Allow": "GET, POST" });
  }

  // --- 個別リソース /items/:id --------------------------------
  const m = req.path.match(/^\/items\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);

    if (req.method === "GET") {
      const item = items.get(id);
      if (!item) return res.json(404, { error: "Not Found", id });
      return res.json(200, item);
    }

    if (req.method === "PUT") {
      // PUT は「このURLの中身を、この内容に置き換えて」という依頼。
      // 置き場所(id)はクライアントが指定する。
      // 何度送っても結果の状態は同じ → 冪等(idempotent)
      const { data, error } = parseJsonBody(req);
      if (error) return res.json(400, { error });

      const existed = items.has(id);
      const item = { ...data, id }; // idはURL側を正とする
      items.set(id, item);          // 部分更新ではなく「丸ごと置き換え」

      console.log(`  ${C.yellow}${existed ? "置き換え" : "新規作成"}: id=${id}（PUTなので何度でも同じ結果）${C.reset}`);

      // 新しく作ったなら 201 + Location、既にあったなら 200
      return existed
        ? res.json(200, item)
        : res.json(201, item, { "Location": `/items/${id}` });
    }

    return res.text(405, "Method Not Allowed\n", { "Allow": "GET, PUT" });
  }

  res.text(404, `404 Not Found: ${req.path}\n`);
});

const PAGE = `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step08: PUT</title>
<body style="font-family:sans-serif;max-width:46em;margin:3em auto;line-height:1.9">
<h1>step08: PUT</h1>
<p><button onclick="list()">一覧を見る</button>
<button onclick="post()">POST /items（押すたび増える）</button>
<button onclick="put()">PUT /items/99（何度押しても1件）</button></p>
<pre id="out" style="background:#eee;padding:1em;white-space:pre-wrap"></pre>
<script>
const out = document.getElementById('out');
async function show(label, r) {
  out.textContent = label + '\\n' +
    'status: ' + r.status + ' ' + r.statusText + '\\n' +
    'Location: ' + (r.headers.get('Location') ?? '(なし)') + '\\n\\n' +
    await r.text();
}
async function list() { show('GET /items', await fetch('/items')); }
async function post() {
  show('POST /items', await fetch('/items', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name: 'ぶどう', price: 300 })
  }));
}
async function put() {
  show('PUT /items/99', await fetch('/items/99', {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name: 'メロン', price: 3000 })
  }));
}
</script>
</body></html>
`;

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step08: PUT");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   curl http://localhost:8080/items");
  console.log("   curl -v -X POST -H 'Content-Type: application/json' \\");
  console.log("        -d '{\"name\":\"ぶどう\"}' http://localhost:8080/items   ← 2回打つと2件増える");
  console.log("   curl -v -X PUT -H 'Content-Type: application/json' \\");
  console.log("        -d '{\"name\":\"メロン\"}' http://localhost:8080/items/99 ← 何回打っても1件");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
