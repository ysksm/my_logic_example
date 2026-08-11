// ============================================================
// step04: ボディを読む
//
// step03 との差分:
//   - Content-Length を見て、ボディが全部届くまで待つ
//   - 「TCPにはメッセージの境界がない」という問題に正面から向き合う
//
//   $ node server.js
// ============================================================

import net from "node:net";

const PORT = 8080;

const C = { gray: "\x1b[90m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", reset: "\x1b[0m" };

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
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    dump("▼ 受信 (この data イベントで届いた分)", C.cyan, chunk);
    buffer = Buffer.concat([buffer, chunk]);

    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      console.log(`${C.yellow}▶ ヘッダーの終わり(\\r\\n\\r\\n)がまだです。続きを待ちます${C.reset}`);
      return;
    }

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

    // ▼▼▼ このステップの新しい部分 ▼▼▼

    // --- ボディは「どこまで」なのか -------------------------------
    //
    //   ヘッダー部分         空行      ボディ
    //   ┌──────────────────┐┌────┐┌──────────────┐
    //   GET / HTTP/1.1\r\n... \r\n\r\n  {"name":"太郎"}
    //                                    ↑ここから
    //
    // ヘッダーの終わりは \r\n\r\n でわかる。
    // しかしボディの終わりを示す印は「存在しない」。
    // TCPは終わりを教えてくれないし、接続は次のリクエストのために
    // 開いたままかもしれない。
    //
    // → だから送信側が Content-Length で「ボディは何バイトです」と
    //   先に宣言する。受信側はその数だけ数えて読む。
    const bodyStart = headerEnd + 4; // "\r\n\r\n" の4バイト分
    const contentLength = Number(headers["content-length"] ?? 0);

    if (buffer.length < bodyStart + contentLength) {
      const got = buffer.length - bodyStart;
      console.log(
        `${C.yellow}▶ ボディが足りません: ${got} / ${contentLength} バイト。続きを待ちます${C.reset}`
      );
      return; // まだボディが全部来ていない
    }

    const body = buffer.subarray(bodyStart, bodyStart + contentLength);

    console.log(`${C.yellow}▶ 1リクエスト分を読み切りました${C.reset}`);
    console.log(`    ${method} ${target} ${version}`);
    console.log(`    Content-Type   : ${headers["content-type"] ?? "(なし)"}`);
    console.log(`    Content-Length : ${contentLength}`);
    console.log(`    ボディ         : ${JSON.stringify(body.toString("utf8"))}`);

    let text =
      `${method} ${target} ${version}\n\n` +
      `Content-Type   : ${headers["content-type"] ?? "(なし)"}\n` +
      `Content-Length : ${contentLength}\n` +
      `--- 受け取ったボディ ---\n` +
      body.toString("utf8") +
      `\n--- ここまで (${body.length} バイト) ---\n`;

    const bodyBuf = Buffer.from(text, "utf8");
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
  console.log(" step04: ボディを読む");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   curl -v -X POST -d 'name=taro&age=20' http://localhost:8080/form");
  console.log("   curl -v -X POST -H 'Content-Type: application/json' \\");
  console.log("        -d '{\"name\":\"太郎\"}' http://localhost:8080/json");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
