/* ============================================================
   HTTP from TCP — スライド共通スクリプト
   各ページの <body data-step="1"> だけ見て、
   トップバー / 進捗 / 前後ステップリンクを自動生成する。
   ============================================================ */

const STEPS = [
  null, // index 合わせのダミー
  { t: "TCPエコーサーバ", d: "steps/step01-tcp-echo" },
  { t: "リクエストラインを読む", d: "steps/step02-request-line" },
  { t: "ヘッダーをパースする", d: "steps/step03-headers" },
  { t: "ボディを読む", d: "steps/step04-body" },
  { t: "レスポンスを組み立てる", d: "steps/step05-response" },
  { t: "GET", d: "steps/step06-get" },
  { t: "POST", d: "steps/step07-post" },
  { t: "PUT", d: "steps/step08-put" },
  { t: "DELETE と適切な応答", d: "steps/step09-delete" },
  { t: "Cookie の往復", d: "steps/step10-cookie" },
  { t: "Cookie 属性とセッション", d: "steps/step11-cookie-attributes" },
  { t: "同一オリジンポリシー", d: "steps/step12-same-origin" },
  { t: "単純リクエストと ACAO", d: "steps/step13-simple-request" },
  { t: "プリフライト", d: "steps/step14-preflight" },
  { t: "Access-Control-Max-Age", d: "steps/step15-max-age" },
  { t: "credentials と Cookie", d: "steps/step16-credentials" },
  { t: "Expose-Headers", d: "steps/step17-expose-headers" },
  { t: "許可リストと落とし穴", d: "steps/step18-origin-allowlist" },
  { t: "特別演習：同一オリジン化リバースプロキシ", d: "steps/step19-reverse-proxy" },
];

const pad = (n) => String(n).padStart(2, "0");

(function () {
  const step = Number(document.body.dataset.step);
  const info = STEPS[step];
  const slides = Array.from(document.querySelectorAll(".slide"));
  let idx = 0;

  // ---- トップバー ----
  const bar = document.createElement("div");
  bar.id = "topbar";
  bar.innerHTML =
    '<a href="index.html">← 目次</a>' +
    '<span class="chip">step' + pad(step) + "</span>" +
    '<span class="deck-title">' + info.t + "</span>" +
    '<span class="spacer"></span>' +
    '<button id="btn-prev">◀</button>' +
    '<span class="chip" id="counter"></span>' +
    '<button id="btn-next">▶</button>' +
    '<button id="btn-all">一覧</button>';
  document.body.prepend(bar);

  const progress = document.createElement("div");
  progress.id = "progress";
  document.body.prepend(progress);

  // ---- 下部ステップナビ ----
  const nav = document.createElement("nav");
  nav.id = "stepnav";
  if (step > 1) {
    nav.innerHTML +=
      '<a class="prev" href="step' + pad(step - 1) + '.html">' +
      '<span class="dir">← 前のステップ</span>step' + pad(step - 1) + " " + STEPS[step - 1].t + "</a>";
  }
  if (step < STEPS.length - 1) {
    nav.innerHTML +=
      '<a class="next" href="step' + pad(step + 1) + '.html">' +
      '<span class="dir">次のステップ →</span>step' + pad(step + 1) + " " + STEPS[step + 1].t + "</a>";
  }
  document.body.append(nav);

  // ---- 表示制御 ----
  function render() {
    slides.forEach((s, i) => s.classList.toggle("active", i === idx));
    document.getElementById("counter").textContent = idx + 1 + " / " + slides.length;
    document.getElementById("btn-prev").disabled = idx === 0;
    document.getElementById("btn-next").disabled = idx === slides.length - 1;
    progress.style.width = ((idx + 1) / slides.length) * 100 + "%";
    if (location.hash !== "#" + (idx + 1)) history.replaceState(null, "", "#" + (idx + 1));
  }

  function go(n) {
    if (document.body.classList.contains("overview")) return;
    idx = Math.max(0, Math.min(slides.length - 1, n));
    render();
    window.scrollTo({ top: 0 });
  }

  document.getElementById("btn-prev").onclick = () => go(idx - 1);
  document.getElementById("btn-next").onclick = () => go(idx + 1);
  document.getElementById("btn-all").onclick = () => {
    const on = document.body.classList.toggle("overview");
    document.getElementById("btn-all").textContent = on ? "1枚ずつ" : "一覧";
    progress.style.width = on ? "100%" : ((idx + 1) / slides.length) * 100 + "%";
    if (!on) render();
  };

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(idx + 1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(idx - 1); }
    if (e.key === "Home") go(0);
    if (e.key === "End") go(slides.length - 1);
    if (e.key === "a") document.getElementById("btn-all").click();
  });

  const start = Number(location.hash.slice(1));
  if (start >= 1 && start <= slides.length) idx = start - 1;
  render();
})();
