// ============================================================
// step02: リクエストラインを読む
//
// step01 との差分:
//   - 受信テキストの「1行目」だけを分解する
//   - HTTPの応答テキストを手書きで組み立てて返す
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
  socket.on("data", (chunk) => {
    dump("▼ 受信 (クライアント → サーバ)", C.cyan, chunk);

    // ▼▼▼ このステップの新しい部分 ▼▼▼

    // --- リクエストラインを取り出す -------------------------------
    // HTTPメッセージの「行」の区切りは \n ではなく \r\n（CRLF）。
    // 1行目だけが特別で、これを「リクエストライン」と呼ぶ。
    const text = chunk.toString("utf8");
    const requestLine = text.split("\r\n")[0];

    // リクエストラインは半角スペース区切りの3つの要素。
    //   GET      /hello?a=1     HTTP/1.1
    //   メソッド  リクエストターゲット  HTTPバージョン
    const [method, target, version] = requestLine.split(" ");

    console.log(`${C.yellow}▶ リクエストラインを分解しました${C.reset}`);
    console.log(`    メソッド        : ${method}`);
    console.log(`    ターゲット      : ${target}`);
    console.log(`    HTTPバージョン  : ${version}`);

    // --- レスポンスを手で書く -------------------------------------
    // 応答も同じ形。1行目は「ステータスライン」と呼ぶ。
    //   HTTP/1.1  200  OK
    //   バージョン ステータスコード 理由句
    //
    // そのあとヘッダーが続き、\r\n\r\n（＝空行）でヘッダーが終わり、
    // 続きがボディになる。この「空行が境界」がHTTPの最重要ルール。
    const body =
      `あなたのリクエストラインはこうでした\n` +
      `  メソッド   : ${method}\n` +
      `  ターゲット : ${target}\n` +
      `  バージョン : ${version}\n`;

    const bodyBuf = Buffer.from(body, "utf8");

    const responseHead =
      "HTTP/1.1 200 OK\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      // ボディが何バイトあるかを伝える。これがないとブラウザは
      // 「まだ続きが来るのかも」と待ち続けてしまう。
      `Content-Length: ${bodyBuf.length}\r\n` +
      // このステップではまだ1接続1リクエストしか扱えないので、
      // 応答したら閉じる、とクライアントに宣言しておく。
      "Connection: close\r\n" +
      "\r\n"; // ← この空行がヘッダーの終わり

    const response = Buffer.concat([Buffer.from(responseHead, "utf8"), bodyBuf]);

    dump("▲ 送信 (サーバ → クライアント)", C.green, response);

    socket.write(response);
    socket.end(); // Connection: close と宣言したので閉じる

    // ▲▲▲ ここまでが新しい部分 ▲▲▲
  });

  socket.on("error", (err) => console.log(`  接続エラー: ${err.message}`));
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step02: リクエストラインを読む");
  console.log("============================================");
  console.log(` 待ち受け中: http://localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   curl -v http://localhost:8080/hello");
  console.log("   curl -v -X POST http://localhost:8080/anything");
  console.log("   ブラウザで http://localhost:8080/  ← 今度はちゃんと表示される");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
