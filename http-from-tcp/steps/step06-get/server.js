// ============================================================
// step06: GET
//
// step05 との差分（HTTPコアは変更なし）:
//   - クエリ文字列を辞書に分解する parseQuery()
//   - パスで処理を振り分ける簡易ルーター
//   - GET は「安全」で「冪等」であるべき、を確かめる
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
 * クエリ文字列 "q=%E7%8A%AC&page=2&tag=a&tag=b" を辞書にする。
 *
 * ポイント:
 *   - 区切りは & と =
 *   - 値はパーセントエンコードされている（%E7%8A%AC → 犬）
 *   - クエリ文字列では + が半角スペースを意味する（歴史的な仕様）
 *   - 同じ名前が複数回出ることがある → 配列で持つ
 */
function parseQuery(qs) {
  const out = {};
  if (!qs) return out;

  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);

    const decode = (s) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        return s; // 壊れたエンコードはそのまま
      }
    };

    const name = decode(rawName);
    const value = decode(rawValue);

    if (name in out) out[name] = [].concat(out[name], value);
    else out[name] = value;
  }
  return out;
}

// GETは「安全(safe)」＝サーバの状態を変えない、が原則。
// このカウンタは「原則を破るとどうなるか」を見るためだけに用意している。
let dangerousCounter = 0;

const server = createHttpServer((req, res) => {
  const query = parseQuery(req.query);
  console.log(`${C.bold}${req.method} ${req.target}${C.reset}`);
  if (Object.keys(query).length) console.log("  クエリ:", query);

  // GET以外はこのステップでは扱わない
  if (req.method !== "GET") {
    return res.text(405, `このステップは GET だけを扱います（受け取ったのは ${req.method}）\n`,
      { "Allow": "GET" });
  }

  // --- ルーティング -------------------------------------------
  // パスを見て処理を振り分けるだけ。これが「ルーター」の正体。

  if (req.path === "/") {
    return res.html(200, `<!DOCTYPE html>
<html lang="ja"><meta charset="utf-8"><title>step06: GET</title>
<body style="font-family:sans-serif;max-width:44em;margin:3em auto;line-height:1.9">
<h1>step06: GET</h1>

<h2>クエリ文字列を送ってみる</h2>
<form action="/search" method="GET">
  <input name="q" placeholder="検索語（日本語や空白もOK）" size="30" value="柴 犬">
  <input name="page" type="number" value="2" size="4">
  <button>GETで送信</button>
</form>
<p>送信するとアドレスバーが <code>/search?q=%E6%9F%B4+%E7%8A%AC&amp;page=2</code>
のように変わります。<strong>GETの入力はすべてURLに載ります。</strong></p>

<h2>リンク</h2>
<ul>
  <li><a href="/search?q=cat&page=1">/search?q=cat&amp;page=1</a></li>
  <li><a href="/search?tag=a&tag=b&tag=c">同じ名前を3回（配列になる）</a></li>
  <li><a href="/items/42">/items/42 — パスの一部を値として使う</a></li>
  <li><a href="/danger">/danger — GETなのに状態を変える悪い例</a></li>
  <li><a href="/nowhere">/nowhere — 404</a></li>
</ul>
</body></html>
`);
  }

  if (req.path === "/search") {
    return res.json(200, {
      説明: "クエリ文字列をパースした結果です",
      生のクエリ: req.query,
      パース結果: query,
    });
  }

  // パスの一部を値として取り出す（いわゆるパスパラメータ）
  const m = req.path.match(/^\/items\/([^/]+)$/);
  if (m) {
    // パス側は %20 が空白。+ は「プラス記号そのもの」なので decodeURIComponent だけ使う。
    return res.json(200, { id: decodeURIComponent(m[1]), path: req.path });
  }

  if (req.path === "/danger") {
    dangerousCounter++;
    return res.text(200,
      `このGETはサーバの状態を変えてしまいました: ${dangerousCounter} 回目\n\n` +
      `GETは「安全(safe)」であるべきです。\n` +
      `ブラウザやプロキシは GET を勝手に先読み・再送・キャッシュすることがあるため、\n` +
      `GETで状態を変えると意図しない回数実行されます。\n`);
  }

  res.text(404, `404 Not Found: ${req.path}\n`);
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step06: GET");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   ブラウザで http://localhost:8080/");
  console.log("   curl 'http://localhost:8080/search?q=%E7%8A%AC&page=2'");
  console.log("   curl 'http://localhost:8080/search?tag=a&tag=b'");
  console.log("   curl 'http://localhost:8080/search?q=a+b'   ← + は空白になる");
  console.log("   curl -v -X POST http://localhost:8080/     ← 405 が返る");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
