// ============================================================
// step01: TCPエコーサーバ
//
// まだHTTPは一切書きません。
// TCPは「バイト列を運ぶ土管」でしかない、ということだけを見ます。
//
//   $ node server.js
// ============================================================

import net from "node:net";

const PORT = 8080;

// ── 見やすくするための道具 ────────────────────────────
// 制御文字 \r \n は画面では見えないので、文字として書き出す。
// これをやると「HTTPは \r\n で行を区切るテキスト」が一目でわかる。
const C = { gray: "\x1b[90m", cyan: "\x1b[36m", green: "\x1b[32m", reset: "\x1b[0m" };

function visualize(buf) {
  return buf
    .toString("utf8")
    .replace(/\r/g, C.gray + "\\r" + C.reset)
    .replace(/\n/g, C.gray + "\\n" + C.reset + "\n");
}

// ── サーバ本体 ────────────────────────────────────────
// net.createServer は「TCP接続が来たら呼ばれる」だけのもの。
// HTTPのことは何も知らない。
const server = net.createServer((socket) => {
  const from = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`\n${C.green}● TCP接続が確立しました${C.reset}  from ${from}`);

  // 相手が送ってきたバイト列が、届いた分だけ何度でもここに来る。
  socket.on("data", (chunk) => {
    console.log(`\n${C.cyan}──── ▼ 受信 (${chunk.length} バイト) ────────────────${C.reset}`);
    process.stdout.write(visualize(chunk));
    console.log(`${C.cyan}────────────────────────────────────────${C.reset}`);

    // 受け取ったものをそのまま送り返す（エコー）。
    // HTTPのルールに従っていないので、ブラウザはこれを理解できない。
    socket.write(chunk);
  });

  socket.on("close", () => console.log(`${C.green}● TCP接続が閉じました${C.reset}    from ${from}`));
  socket.on("error", (err) => console.log(`  接続エラー: ${err.message}`));
});

server.listen(PORT, () => {
  console.log("============================================");
  console.log(" step01: TCPエコーサーバ");
  console.log("============================================");
  console.log(` 待ち受け中: localhost:${PORT}`);
  console.log("");
  console.log(" ためすこと:");
  console.log("   1) 別のターミナルで  nc localhost 8080");
  console.log("      → 何か打ってEnter。そのまま返ってくる");
  console.log("   2) 別のターミナルで  curl -v http://localhost:8080/hello");
  console.log("      → curl が送ったHTTPの生テキストがここに表示される");
  console.log("   3) ブラウザで  http://localhost:8080");
  console.log("      → エラーになる。それが正解（HTTPの応答を返していないため）");
  console.log("");
  console.log(" 終了: Ctrl+C");
});
