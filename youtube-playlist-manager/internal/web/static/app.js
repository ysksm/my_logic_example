"use strict";

// ── state ───────────────────────────────────────────────
const state = {
  channels: [],
  playlists: [],
  videos: [],
  channelId: "",   // "" = all channels
  playlistId: "",
  view: load("view", "grid"),
  sort: load("sort", "date-desc"),
  q: "",
  status: null,
};

function load(k, def) {
  try { return localStorage.getItem("ypm." + k) || def; } catch { return def; }
}
function save(k, v) {
  try { localStorage.setItem("ypm." + k, v); } catch { /* ignore */ }
}

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
};

// ── api ─────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.result = data.result;
    throw err;
  }
  return data;
}

// ── formatting ──────────────────────────────────────────
const nf = new Intl.NumberFormat("ja-JP");
const fmtN = (n) => nf.format(n || 0);
function fmtCompact(n) {
  n = n || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + "億";
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1) + "万";
  return nf.format(n);
}
function fmtDate(s) {
  if (!s || s.startsWith("0001")) return "-";
  const d = new Date(s);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDateTime(s) {
  if (!s || s.startsWith("0001")) return "未取得";
  const d = new Date(s);
  return `${fmtDate(s)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return "";
  const h = (+m[1] || 0) * 24 + (+m[2] || 0), mi = +m[3] || 0, s = +m[4] || 0;
  if (h + mi + s === 0) return iso === "P0D" ? "LIVE" : "";
  const pad = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
}
const watchURL = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
const usageText = (u) => (u && u.units ? `（${u.units} unit 消費）` : "");

// ── toasts ──────────────────────────────────────────────
function toast(msg, isErr = false) {
  const t = el("div", { class: "toast" + (isErr ? " err" : "") }, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), isErr ? 8000 : 4500);
}
function toastErr(e) {
  let msg = e.message;
  if (e.status === 412) msg = "API キーが未設定です。右上の「設定」から登録してください。";
  if (e.status === 429) msg = "本日の API クォータを使い切りました（太平洋時間 0 時にリセット）。" + msg;
  toast(msg + usageText(e.result), true);
}

// ── loading ─────────────────────────────────────────────
async function refreshStatus() {
  state.status = await api("GET", "/api/status");
  const q = state.status.quota, lim = state.status.dailyLimit || 10000;
  const pct = Math.min(100, (q.used / lim) * 100);
  const fill = $("#quota-fill");
  fill.style.width = pct + "%";
  fill.className = "meter-fill" + (pct >= 90 ? " crit" : pct >= 70 ? " warn" : "");
  $("#quota-text").textContent = `${fmtN(q.used)} / ${fmtN(lim)}`;
  $("#quota").title =
    `YouTube Data API の本日 (${q.date} 太平洋時間) の使用量\n` +
    Object.entries(q.calls || {}).map(([k, v]) => `${k}: ${v} 回`).join("\n");
}

async function refreshChannels() {
  state.channels = await api("GET", "/api/channels");
  if (state.channelId && !state.channels.some((c) => c.id === state.channelId)) {
    state.channelId = "";
    state.playlistId = "";
  }
  renderChannels();
  renderChannelPanel();
}

async function refreshPlaylists() {
  state.playlists = state.channelId
    ? await api("GET", `/api/playlists?channelId=${encodeURIComponent(state.channelId)}`)
    : [];
  renderPlaylists();
}

async function refreshVideos() {
  const p = new URLSearchParams();
  if (state.playlistId) p.set("playlistId", state.playlistId);
  else if (state.channelId) p.set("channelId", state.channelId);
  state.videos = await api("GET", "/api/videos?" + p);
  $("#exp-csv").href = "/api/export?format=csv&" + p;
  $("#exp-json").href = "/api/export?format=json&" + p;
  renderVideos();
}

async function reloadAll() {
  await Promise.all([refreshStatus(), refreshChannels()]);
  await Promise.all([refreshPlaylists(), refreshVideos()]);
}

// ── sidebar ─────────────────────────────────────────────
function renderChannels() {
  const ul = $("#channel-list");
  ul.replaceChildren(
    el("li", { class: state.channelId ? "" : "sel", onclick: () => select("") },
      el("div", { class: "all-icon" }, "★"),
      el("div", { class: "info" },
        el("div", { class: "name" }, "すべてのチャンネル"),
        el("div", { class: "sub" }, `${state.channels.length} チャンネル登録済み`))),
    ...state.channels.map((c) =>
      el("li", { class: c.id === state.channelId ? "sel" : "", onclick: () => select(c.id), title: c.description },
        el("img", { src: c.thumbnailUrl, alt: "", loading: "lazy" }),
        el("div", { class: "info" },
          el("div", { class: "name" }, c.title),
          el("div", { class: "sub" },
            `保存 ${fmtN(c.storedVideoCount)} / 全 ${fmtN(c.videoCount)} 本 · ` +
            (c.lastFetchedAt.startsWith("0001") ? "未取得" : "取得 " + fmtDate(c.lastFetchedAt)))))),
  );
}

function current() {
  return state.channels.find((c) => c.id === state.channelId);
}

function renderChannelPanel() {
  const c = current();
  const panel = $("#channel-panel");
  panel.hidden = !c;
  if (!c) return;
  $("#cp-title").textContent = c.title;
  $("#cp-meta").textContent =
    `${c.customUrl || c.id} · 登録者 ${fmtCompact(c.subscriberCount)} · ` +
    `最終取得 ${fmtDateTime(c.lastFetchedAt)}` +
    (c.reachedEnd ? " · 全動画取得済み" : "");
  panel.querySelector('[data-act="older"]').disabled = c.reachedEnd;
  updateCostHint();
}

function updateCostHint() {
  const c = current();
  if (!c) return;
  const max = +$("#cp-max").value;
  const pages = Math.ceil(max / 50);
  $("#cp-cost").textContent =
    `目安: 動画取得 最大 ${pages * 2} unit（一覧 ${pages} + 詳細 ${pages}）/ ` +
    `統計更新 ${Math.max(1, Math.ceil(c.storedVideoCount / 50))} unit / 再生リスト一覧 1 unit〜`;
}

function renderPlaylists() {
  const ul = $("#playlist-list");
  if (!state.playlists.length) {
    ul.replaceChildren(el("li", { class: "muted small" }, "「再生リスト一覧を取得」で読み込みます"));
    return;
  }
  ul.replaceChildren(
    ...state.playlists.map((p) => {
      const fetched = !p.lastFetchedAt.startsWith("0001");
      const btn = el("button", {
        class: "btn", title: `動画を最大 200 件取得（約 ${Math.ceil(Math.min(p.itemCount, 200) / 50) * 2} unit）`,
        onclick: async (ev) => {
          ev.stopPropagation();
          await run(btn, async () => {
            const r = await api("POST", `/api/playlists/${encodeURIComponent(p.id)}/fetch?max=200`);
            toast(`「${p.title}」: ${r.fetched} 本取得（新規 ${r.new}）${usageText(r)}`);
            state.playlistId = p.id;
          });
        },
      }, fetched ? "再取得" : "取得");
      return el("li", {
        class: p.id === state.playlistId ? "sel" : "",
        onclick: () => selectPlaylist(p.id === state.playlistId ? "" : p.id),
        title: p.description,
      },
        el("div", { class: "pl-info" },
          el("div", { class: "pl-title" }, p.title),
          el("div", { class: "small muted" },
            `${fmtN(p.itemCount)} 本` + (fetched ? ` · 保存 ${fmtN((p.videoIds || []).length)}` : " · 未取得"))),
        btn);
    }),
  );
}

async function select(id) {
  state.channelId = id;
  state.playlistId = "";
  renderChannels();
  renderChannelPanel();
  await Promise.all([refreshPlaylists(), refreshVideos()]);
}

async function selectPlaylist(id) {
  state.playlistId = id;
  renderPlaylists();
  await refreshVideos();
}

// Disables btn while fn runs, then reloads everything.
async function run(btn, fn) {
  const buttons = document.querySelectorAll("#channel-panel .btn, #playlist-list .btn");
  buttons.forEach((b) => (b.disabled = true));
  const label = btn.textContent;
  btn.textContent = "取得中…";
  try {
    await fn();
  } catch (e) {
    toastErr(e);
  } finally {
    btn.textContent = label;
    buttons.forEach((b) => (b.disabled = false));
    await reloadAll().catch(toastErr);
  }
}

async function channelAction(act, btn) {
  const c = current();
  if (!c) return;
  const id = encodeURIComponent(c.id);
  const max = $("#cp-max").value;
  switch (act) {
    case "latest":
    case "older":
      return run(btn, async () => {
        const r = await api("POST", `/api/channels/${id}/fetch?mode=${act}&max=${max}`);
        const tail = r.reachedEnd ? " · 最後まで取得しました" : "";
        toast(`${c.title}: 新規 ${r.new} 本${r.new === 0 && act === "latest" ? "（新着なし）" : ""}${tail}${usageText(r)}`);
      });
    case "stats":
      return run(btn, async () => {
        const r = await api("POST", `/api/channels/${id}/refresh-stats`);
        toast(`${c.title}: ${r.fetched} 本の統計を更新${usageText(r)}`);
      });
    case "playlists":
      return run(btn, async () => {
        const r = await api("POST", `/api/channels/${id}/playlists/fetch`);
        toast(`${c.title}: 再生リスト ${r.fetched} 件${usageText(r)}`);
      });
    case "refresh":
      return run(btn, async () => {
        const r = await api("POST", `/api/channels/${id}/refresh`);
        toast(`${c.title}: チャンネル情報を更新${usageText(r.usage)}`);
      });
    case "delete":
      if (!confirm(`「${c.title}」の登録を解除し、保存済みの動画・再生リストも削除しますか？`)) return;
      return run(btn, async () => {
        await api("DELETE", `/api/channels/${id}`);
        state.channelId = "";
        state.playlistId = "";
        toast(`「${c.title}」を削除しました`);
      });
  }
}

// ── videos ──────────────────────────────────────────────
const sorters = {
  "date-desc": (a, b) => b.publishedAt.localeCompare(a.publishedAt),
  "date-asc": (a, b) => a.publishedAt.localeCompare(b.publishedAt),
  views: (a, b) => b.viewCount - a.viewCount,
  likes: (a, b) => b.likeCount - a.likeCount,
  comments: (a, b) => b.commentCount - a.commentCount,
  title: (a, b) => a.title.localeCompare(b.title, "ja"),
};

function visibleVideos() {
  const q = state.q.trim().toLowerCase();
  let vs = state.videos;
  if (q) vs = vs.filter((v) => (v.title + "\n" + v.description).toLowerCase().includes(q));
  // Playlists keep their own order unless the user picked another sort.
  if (!(state.playlistId && state.sort === "playlist")) vs = [...vs].sort(sorters[state.sort] || sorters["date-desc"]);
  return vs;
}

function renderCrumb() {
  const c = current();
  const p = state.playlists.find((x) => x.id === state.playlistId);
  $("#crumb").textContent = c ? c.title + (p ? " › " + p.title : "") : "すべてのチャンネル";
}

function renderVideos() {
  renderCrumb();
  const vs = visibleVideos();
  const box = $("#videos");
  const empty = $("#empty");
  $("#count").textContent = `${fmtN(vs.length)} 本` + (vs.length !== state.videos.length ? `（全 ${fmtN(state.videos.length)} 本中）` : "");

  if (!vs.length) {
    box.replaceChildren();
    empty.hidden = false;
    empty.replaceChildren(...emptyMessage());
    return;
  }
  empty.hidden = true;
  box.replaceChildren(state.view === "list" ? renderTable(vs) : renderGrid(vs));
}

function emptyMessage() {
  if (!state.status?.apiKeySource) return ["まずは右上の「⚙ 設定」で YouTube Data API キーを登録してください。"];
  if (!state.channels.length) return ["左上の入力欄からチャンネルを登録してください。", el("br"), "例: https://www.youtube.com/@GoogleDevelopers"];
  if (state.q) return ["条件に一致する動画はありません。"];
  if (state.playlistId) return ["この再生リストの動画はまだ取得していません。「取得」を押してください。"];
  if (state.channelId) return ["このチャンネルの動画はまだ取得していません。", el("br"), "左の「⟳ 最新の動画を取得」を押すと、そのチャンネルだけ API を使って取得します。"];
  return ["チャンネルを選んで動画を取得してください。"];
}

function statsLine(v) {
  return el("div", { class: "stats" },
    el("span", { title: fmtN(v.viewCount) + " 回" }, "▶ " + fmtCompact(v.viewCount)),
    el("span", { title: fmtN(v.likeCount) }, "👍 " + fmtCompact(v.likeCount)),
    el("span", { title: fmtN(v.commentCount) }, "💬 " + fmtCompact(v.commentCount)),
    el("span", {}, "📅 " + fmtDate(v.publishedAt)));
}

function renderGrid(vs) {
  const showCh = !state.channelId || state.playlistId;
  return el("div", { class: "grid" }, vs.map((v) =>
    el("a", { class: "card", href: watchURL(v.id), target: "_blank", rel: "noopener", title: v.title },
      el("div", { class: "thumb" },
        el("img", { src: v.thumbnailUrl, alt: "", loading: "lazy" }),
        fmtDuration(v.duration) && el("span", { class: "dur" }, fmtDuration(v.duration))),
      el("div", { class: "card-body" },
        el("div", { class: "card-title" }, v.title),
        showCh && el("div", { class: "small muted" }, v.channelTitle),
        el("div", { class: "card-desc" }, v.description),
        statsLine(v)))));
}

function renderTable(vs) {
  const cols = [
    ["", null], ["タイトル / 概要", "title"], ["公開日", "date-desc"],
    ["再生回数", "views"], ["いいね", "likes"], ["コメント", "comments"], ["長さ", null],
  ];
  const head = el("tr", {}, cols.map(([label, key], i) =>
    el("th", {
      class: i >= 3 ? "num" : "",
      onclick: key ? () => setSort(state.sort === key && key === "date-desc" ? "date-asc" : key) : null,
    }, label + (key && (state.sort === key || (key === "date-desc" && state.sort === "date-asc")) ? (state.sort === "date-asc" ? " ▲" : " ▼") : ""))));
  const rows = vs.map((v) => {
    const desc = el("div", { class: "t-desc" }, v.description);
    const more = v.description.length > 80
      ? el("button", {
          class: "t-more",
          onclick: (ev) => { ev.stopPropagation(); desc.classList.toggle("open"); more.textContent = desc.classList.contains("open") ? "閉じる" : "概要をすべて表示"; },
        }, "概要をすべて表示")
      : null;
    return el("tr", { onclick: () => window.open(watchURL(v.id), "_blank", "noopener") },
      el("td", { class: "t-thumb" }, el("img", { src: v.thumbnailUrl, alt: "", loading: "lazy" })),
      el("td", {},
        el("a", { class: "t-title", href: watchURL(v.id), target: "_blank", rel: "noopener", onclick: (ev) => ev.stopPropagation() }, v.title),
        (!state.channelId || state.playlistId) && el("div", { class: "t-ch" }, v.channelTitle),
        desc, more),
      el("td", { class: "num" }, fmtDate(v.publishedAt)),
      el("td", { class: "num" }, fmtN(v.viewCount)),
      el("td", { class: "num" }, fmtN(v.likeCount)),
      el("td", { class: "num" }, fmtN(v.commentCount)),
      el("td", { class: "num" }, fmtDuration(v.duration)));
  });
  return el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, rows)));
}

function setSort(s) {
  state.sort = s;
  $("#sort").value = s;
  save("sort", s);
  renderVideos();
}

function setView(v) {
  state.view = v;
  save("view", v);
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  renderVideos();
}

// ── settings ────────────────────────────────────────────
function openSettings() {
  const s = state.status || {};
  $("#set-key").value = "";
  $("#set-limit").value = s.dailyLimit || 10000;
  $("#set-key-hint").textContent =
    s.apiKeySource === "env" ? "環境変数 YOUTUBE_API_KEY が設定されているため、そちらが優先されます。"
    : s.apiKeySource === "settings" ? `保存済み: ${s.apiKeyMasked}（空欄のまま保存すると変更しません）`
    : "Google Cloud Console で YouTube Data API v3 を有効化し、API キーを作成してください。";
  $("#settings").showModal();
}

async function saveSettings() {
  const body = { dailyLimit: +$("#set-limit").value || 10000 };
  const key = $("#set-key").value.trim();
  if (key) body.apiKey = key;
  try {
    await api("PUT", "/api/settings", body);
    toast("設定を保存しました");
    await reloadAll();
  } catch (e) { toastErr(e); }
}

// ── wiring ──────────────────────────────────────────────
function init() {
  $("#sort").value = state.sort;
  setView(state.view);

  $("#add-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = $("#add-input");
    const btn = ev.submitter || $("#add-form .btn");
    if (!input.value.trim()) return;
    btn.disabled = true;
    try {
      const r = await api("POST", "/api/channels", { input: input.value });
      input.value = "";
      toast(`「${r.channel.title}」を登録しました${usageText(r.usage)}`);
      await refreshStatus();
      await refreshChannels();
      await select(r.channel.id);
    } catch (e) {
      toastErr(e);
      refreshStatus().catch(() => {});
    } finally {
      btn.disabled = false;
    }
  });

  document.querySelectorAll("#channel-panel [data-act]").forEach((b) =>
    b.addEventListener("click", () => channelAction(b.dataset.act, b)));
  $("#cp-max").addEventListener("change", updateCostHint);

  $("#q").addEventListener("input", (e) => { state.q = e.target.value; renderVideos(); });
  $("#sort").addEventListener("change", (e) => setSort(e.target.value));
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

  $("#btn-settings").addEventListener("click", openSettings);
  $("#settings-form").addEventListener("submit", (ev) => {
    if (ev.submitter?.value === "save") saveSettings();
  });

  reloadAll().then(() => {
    if (!state.status.apiKeySource) openSettings();
  }).catch(toastErr);
}

init();
