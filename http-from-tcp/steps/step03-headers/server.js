// ============================================================
// step03: ヘッダーをパースする
//
// step02 との差分:
//   - データが分割して届く可能性に対応（バッファに溜める）
//   - \r\n\r\n を見つけるまで待ってから、ヘッダー行をすべて解析する
//   - ヘッダー名は大文字小文字を区別しない（小文字に正規化して持つ）
//
//   $ node server.js
// ============================================================

import net from "node:net";

const PORT = 8080;

const C = { gray: "\x1b[90m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", reset: "\x1b[0m" };

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

const server = net.createServer((socket) => {
  // ▼▼▼ このステップの新しい部分 ▼▼▼

  // TCPは「1回のwriteが1回のdataで届く」ことを保証しない。
  // 巨大なヘッダーは2回3回に分かれて届くこともある。
  // だから受信したものはいったんここに溜める。
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    dump("▼ 受信 (この data イベントで届いた分)", C.cyan, chunk);
    buffer = Buffer.concat([buffer, chunk]);

    // --- ヘッダーの終わり（空行）を探す ---------------------------
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      console.log(`${C.yellow}▶ まだ \\r\\n\\r\\n が来ていません。続きを待ちます${C.reset}`);
      return; // まだヘッダーが揃っていない
    }

    // --- ヘッダーブロックを行に分ける -----------------------------
    const headText = buffer.subarray(0, headerEnd).toString("utf8");
    const lines = headText.split("\r\n");

    const requestLine = lines[0];
    const [method, target, version] = requestLine.split(" ");

    // --- 2行目以降が「フィールド名: 値」 --------------------------
    const headers = {};
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(":");
      if (colon === -1) continue; // 壊れた行は無視

      // ヘッダー名は大文字小文字を区別しない（RFC 9110）。
      // Host / host / HOST はすべて同じ。だから小文字に揃えて持つ。
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();

      // 同じ名前が複数回来たら "," で連結するのがHTTPの規則。
      // （Set-Cookie だけは例外。step10 で扱う）
      headers[name] = name in headers ? headers[name] + ", " + value : value;
    }

    console.log(`${C.yellow}▶ 解析結果${C.reset}`);
    console.log(`    ${method} ${target} ${version}`);
    for (const [k, v] of Object.entries(headers)) {
      console.log(`    ${k.padEnd(20)} = ${v}`);
    }

    // --- 解析結果をそのまま返す -----------------------------------
    let body = `${method} ${target} ${version}\n\n[ヘッダー ${Object.keys(headers).length} 個]\n`;
    for (const [k, v] of Object.entries(headers)) {
      body += `${k.padEnd(24)} : ${v}\n`;
    }

    const bodyBuf = Buffer.from(body, "utf8");
    const response = Buffer.concat([
      Buffer.from(
        "HTTP/1.1 200 OK\r\n" +
          "Content-Type: text/plain; charset=utf-8\r\n" +
          `Content-Length: ${bodyBuf.length}\r\n` +
          "Connection: close\r\n" +
          "\r\n",
        "utf8"
      ),
      bodyBuf,
    ]);

    dump("▲ 送信 (サーバ → クライアント)", C.green, response);
    socket.write(response);
    socket.end();

    // ▲▲▲ ここまでが新しい部分 ▲▲▲
  });

  socket.on("error", (err) => console.log(`  接続エラー: ${err.message}`));
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step03: ヘッダーをパースする");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   curl -v http://localhost:8080/");
  console.log("   curl -H 'X-Foo: 1' -H 'x-FOO: 2' http://localhost:8080/");
  console.log("   ブラウザで http://localhost:8080/ ← ブラウザが送るヘッダーの量を見る");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
