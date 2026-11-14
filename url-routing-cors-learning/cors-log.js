// STEP 6 / 7 共通: API サーバー (:4000) が受け取ったリクエストのログを表示する
// window.API_ORIGIN は /config.js（server.js が生成）で設定される

window.CorsLog = {
  // ログを取得して <div class="log"> に描画する
  async refresh(target) {
    try {
      const res = await fetch(`${API_ORIGIN}/__log`, { cache: "no-store" });
      const entries = await res.json();
      target.replaceChildren();
      if (!entries.length) {
        target.append(line("dim", "（まだリクエストはありません）"));
        return;
      }
      for (const e of entries.slice(0, 15)) {
        const reqH = Object.entries(e.requestHeaders)
          .filter(([, v]) => v)
          .map(([k, v]) => `      > ${k}: ${v}`);
        const resH = Object.entries(e.responseCors).map(([k, v]) => `      < ${k}: ${v}`);
        const cls = e.method === "OPTIONS" ? "pf" : "ok";
        target.append(
          line(cls, `${e.time}  ${e.method.padEnd(7)} ${e.path}   Origin: ${e.origin}`),
          line("dim", [...reqH, ...(resH.length ? resH : ["      < (CORS ヘッダーなし)"])].join("\n")),
        );
      }
    } catch (err) {
      target.replaceChildren(line("ng", `API サーバー (${API_ORIGIN}) に接続できません。node server.js は起動していますか？`));
    }
  },
  async clear(target) {
    await fetch(`${API_ORIGIN}/__log?clear=1`, { cache: "no-store" }).catch(() => {});
    await this.refresh(target);
  },
};

function line(cls, text) {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

// 結果表示用: 成功/失敗をバッジ付きで出す
window.showResult = function (target, ok, text) {
  const badge = document.createElement("span");
  badge.className = "badge " + (ok ? "ok" : "ng");
  badge.textContent = ok ? "成功" : "失敗";
  const pre = document.createElement("div");
  pre.className = "log";
  pre.textContent = text;
  target.replaceChildren(badge, pre);
};
