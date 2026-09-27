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
  jobs: [],
  jobsLoaded: false,
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
  updateExportLinks();
  renderVideos();
}

function updateExportLinks() {
  const p = new URLSearchParams();
  if (state.playlistId) p.set("playlistId", state.playlistId);
  else if (state.channelId) p.set("channelId", state.channelId);
  if ($("#exp-tr").checked) p.set("transcripts", "1");
  $("#exp-csv").href = "/api/export?format=csv&" + p;
  $("#exp-json").href = "/api/export?format=json&" + p;
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
    `保存 ${fmtN(c.storedVideoCount)} / 全 ${fmtN(c.videoCount)} 本 · 字幕 ${fmtN(c.storedTranscriptCount)} 本 · ` +
    `最終取得 ${fmtDateTime(c.lastFetchedAt)}` +
    (c.reachedEnd ? " · 全動画取得済み" : "");
  panel.querySelector('[data-act="older"]').disabled = c.reachedEnd;
  updateCostHint();
  updateBusy();
}

function updateCostHint() {
  const c = current();
  if (!c) return;
  const units = (n) => Math.max(1, Math.ceil(n / 50));
  const remaining = Math.max(0, c.videoCount - c.storedVideoCount);
  $("#cp-cost").textContent =
    `消費の目安: 差分更新 2 unit 前後 / 全動画を取得 約 ${units(remaining) * 2} unit / ` +
    `古い動画 ${+$("#cp-max").value} 本 約 ${units(+$("#cp-max").value) * 2} unit / ` +
    `再取得 約 ${units(c.videoCount) * 2} unit / 統計のみ ${units(c.storedVideoCount)} unit`;
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
      const pid = encodeURIComponent(p.id);
      const fetchBtn = el("button", {
        class: "btn", "data-target": "playlist:" + p.id,
        title: `再生リストの動画をすべて取得（約 ${Math.max(1, Math.ceil(p.itemCount / 50)) * 2} unit）`,
        onclick: (ev) => {
          ev.stopPropagation();
          startJob(`/api/playlists/${pid}/fetch`);
        },
      }, fetched ? "再取得" : "取得");
      const trBtn = fetched && el("button", {
        class: "btn", "data-target": "transcripts:" + p.id, title: "この再生リストの動画の字幕を取得（未取得分）",
        onclick: (ev) => {
          ev.stopPropagation();
          startJob(`/api/playlists/${pid}/transcripts?mode=missing`);
        },
      }, "字幕");
      return el("li", {
        class: p.id === state.playlistId ? "sel" : "",
        onclick: () => selectPlaylist(p.id === state.playlistId ? "" : p.id),
        title: p.description,
      },
        el("div", { class: "pl-info" },
          el("div", { class: "pl-title" }, p.title),
          el("div", { class: "small muted" },
            `${fmtN(p.itemCount)} 本` + (fetched ? ` · 保存 ${fmtN((p.videoIds || []).length)}` : " · 未取得"))),
        trBtn, fetchBtn);
    }),
  );
  updateBusy();
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

// ── background jobs ─────────────────────────────────────
let pollTimer = null;
const seenJobs = new Set(); // finished jobs already announced

async function startJob(path) {
  try {
    const r = await api("POST", path);
    state.jobs = [r.job, ...state.jobs.filter((j) => j.id !== r.job.id)];
    renderJobs();
    pollJobs();
  } catch (e) {
    toastErr(e);
  }
}

function jobSummary(j) {
  const r = j.result || {};
  const units = usageText(r);
  switch (j.kind) {
    case "videos":
      return `新規 ${fmtN(r.new)} 本` + (r.removed ? `・削除 ${fmtN(r.removed)} 本` : "") +
        (r.fetched && r.fetched !== r.new ? `・更新 ${fmtN(r.fetched)} 本` : "") +
        (r.reachedEnd ? "（全動画取得済み）" : "") + units;
    case "stats": return `${fmtN(r.fetched)} 本の統計を更新${units}`;
    case "playlists": return `再生リスト ${fmtN(r.fetched)} 件${units}`;
    case "playlist-videos": return `${fmtN(r.fetched)} 本（新規 ${fmtN(r.new)}）${units}`;
    case "transcripts":
      return `取得 ${fmtN(r.fetched)}・字幕なし ${fmtN(r.none)}・失敗 ${fmtN(r.failed)}・スキップ ${fmtN(r.skipped)}`;
  }
  return "";
}

async function pollJobs() {
  clearTimeout(pollTimer);
  try {
    state.jobs = await api("GET", "/api/jobs");
  } catch {
    pollTimer = setTimeout(pollJobs, 3000);
    return;
  }
  let finished = false;
  for (const j of state.jobs) {
    if (j.status === "running" || seenJobs.has(j.id)) continue;
    seenJobs.add(j.id);
    if (!state.jobsLoaded) continue; // don't replay jobs finished before this page load
    finished = true;
    const msg = `${j.label}: ` + (j.status === "done" ? jobSummary(j)
      : j.status === "canceled" ? "キャンセルしました（取得済みの分は保存されています）"
      : j.error + (j.result ? `（${jobSummary(j)}）` : ""));
    if (j.status === "error") toastErr(Object.assign(new Error(msg), { status: /quota/i.test(j.error) ? 429 : 0 }));
    else toast(msg);
  }
  state.jobsLoaded = true;
  renderJobs();
  const running = state.jobs.some((j) => j.status === "running");
  if (finished) {
    await reloadAll().catch(() => {});
  } else if (running) {
    // Keep counts and quota current without re-rendering the video list.
    await Promise.all([refreshStatus(), refreshChannels()]).catch(() => {});
  }
  if (running) pollTimer = setTimeout(pollJobs, 1500);
}

function runningTargets() {
  return new Set(state.jobs.filter((j) => j.status === "running").map((j) => j.target));
}

function updateBusy() {
  const targets = runningTargets();
  const c = current();
  if (c) {
    const chBusy = targets.has("channel:" + c.id);
    document.querySelectorAll('#channel-panel [data-act="latest"], #channel-panel [data-act="all"], #channel-panel [data-act="older"], #channel-panel [data-act="refetch"], #channel-panel [data-act="stats"]')
      .forEach((b) => (b.disabled = chBusy || (b.dataset.act === "older" && c.reachedEnd)));
    $('#channel-panel [data-act="playlists"]').disabled = targets.has("playlists:" + c.id);
    document.querySelectorAll('#channel-panel [data-act^="tr-"]').forEach((b) => (b.disabled = targets.has("transcripts:" + c.id)));
  }
  document.querySelectorAll("#playlist-list [data-target]").forEach((b) => (b.disabled = targets.has(b.dataset.target)));
}

function renderJobs() {
  const box = $("#jobs");
  const recent = state.jobs.filter((j) => j.status === "running");
  box.replaceChildren(...recent.map((j) => {
    const pct = j.total > 0 ? Math.min(100, (j.done / j.total) * 100) : 0;
    return el("div", { class: "job" },
      el("div", { class: "job-head" },
        el("span", { class: "job-label", title: j.label }, j.label),
        el("button", {
          class: "btn ghost", title: "中断（取得済みの分は保存されます）",
          onclick: () => api("POST", `/api/jobs/${j.id}/cancel`).then(pollJobs).catch(toastErr),
        }, "中断")),
      el("div", { class: "job-bar" + (j.total > 0 ? "" : " indeterminate") }, el("div", { style: `width:${pct}%` })),
      el("div", { class: "muted" }, j.message || "開始しています…"));
  }));
  updateBusy();
}

async function channelAction(act, btn) {
  const c = current();
  if (!c) return;
  const id = encodeURIComponent(c.id);
  const units = (n) => Math.max(1, Math.ceil(n / 50)) * 2;
  switch (act) {
    case "latest":
      return startJob(`/api/channels/${id}/fetch?mode=latest`);
    case "all":
      return startJob(`/api/channels/${id}/fetch?mode=all`);
    case "older":
      return startJob(`/api/channels/${id}/fetch?mode=older&max=${$("#cp-max").value}`);
    case "refetch":
      if (!confirm(`「${c.title}」の全 ${fmtN(c.videoCount)} 本を取り直します（約 ${units(c.videoCount)} unit）。\n` +
        "タイトル・概要・統計が最新になり、チャンネルから削除された動画は一覧から外れます。よろしいですか？")) return;
      return startJob(`/api/channels/${id}/fetch?mode=refetch`);
    case "stats":
      return startJob(`/api/channels/${id}/refresh-stats`);
    case "playlists":
      return startJob(`/api/channels/${id}/playlists/fetch`);
    case "tr-missing":
      if (!c.storedVideoCount) return toast("先に動画を取得してください", true);
      return startJob(`/api/channels/${id}/transcripts?mode=missing`);
    case "tr-all":
      if (!confirm(`保存済みの ${fmtN(c.storedVideoCount)} 本すべての字幕を取り直します。本数が多いと時間がかかります。よろしいですか？`)) return;
      return startJob(`/api/channels/${id}/transcripts?mode=all`);
    case "refresh":
      btn.disabled = true;
      try {
        const r = await api("POST", `/api/channels/${id}/refresh`);
        toast(`${c.title}: チャンネル情報を更新${usageText(r.usage)}`);
      } catch (e) {
        toastErr(e);
      } finally {
        btn.disabled = false;
        await reloadAll().catch(toastErr);
      }
      return;
    case "delete":
      if (runningTargets().has("channel:" + c.id) || runningTargets().has("transcripts:" + c.id)) {
        return toast("実行中の処理を中断してから削除してください", true);
      }
      if (!confirm(`「${c.title}」の登録を解除し、保存済みの動画・再生リスト・字幕も削除しますか？`)) return;
      try {
        await api("DELETE", `/api/channels/${id}`);
        state.channelId = "";
        state.playlistId = "";
        toast(`「${c.title}」を削除しました`);
      } catch (e) {
        toastErr(e);
      }
      await reloadAll().catch(toastErr);
      return;
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
  if (state.channelId) return ["このチャンネルの動画はまだ取得していません。", el("br"), "左の「⤓ 全動画を取得」ですべて、「⟳ 差分更新」で新着だけを取得できます（このチャンネルの分だけ API を使います）。"];
  return ["チャンネルを選んで動画を取得してください。"];
}

function statsLine(v) {
  return el("div", { class: "stats" },
    el("span", { title: fmtN(v.viewCount) + " 回" }, "▶ " + fmtCompact(v.viewCount)),
    el("span", { title: fmtN(v.likeCount) }, "👍 " + fmtCompact(v.likeCount)),
    el("span", { title: fmtN(v.commentCount) }, "💬 " + fmtCompact(v.commentCount)),
    el("span", {}, "📅 " + fmtDate(v.publishedAt)));
}

// Badge that opens the transcript viewer.
function trBadge(v) {
  const st = v.transcriptStatus || "";
  const label = { ok: "📝 字幕", none: "字幕なし", error: "📝 字幕（失敗）" }[st] || "📝 字幕を取得";
  const title = { ok: `字幕を表示（${v.transcriptLanguage}）`, none: "この動画には字幕がありません（クリックで再確認）",
    error: "前回の取得に失敗しました（クリックで再取得）" }[st] || "クリックで字幕を取得（クォータ不要）";
  return el("button", {
    class: "tr-badge " + st, title,
    onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); openTranscript(v); },
  }, label);
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
        statsLine(v),
        el("div", {}, trBadge(v))))));
}

function renderTable(vs) {
  const cols = [
    ["", null], ["タイトル / 概要", "title"], ["公開日", "date-desc"],
    ["再生回数", "views"], ["いいね", "likes"], ["コメント", "comments"], ["長さ", null], ["字幕", null],
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
      el("td", { class: "num" }, fmtDuration(v.duration)),
      el("td", {}, trBadge(v)));
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

// ── transcript viewer ───────────────────────────────────
const trState = { video: null, data: null };

function fmtClock(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function openTranscript(v) {
  trState.video = v;
  trState.data = null;
  $("#tr-title").textContent = v.title;
  $("#tr-open").href = watchURL(v.id);
  $("#tr-q").value = "";
  $("#tr-meta").textContent = "";
  $("#tr-dialog").showModal();
  if (v.transcriptStatus === "ok") {
    $("#tr-body").replaceChildren(el("div", { class: "tr-empty" }, "読み込み中…"));
    try {
      trState.data = await api("GET", `/api/videos/${encodeURIComponent(v.id)}/transcript`);
    } catch { /* fall through to fetch */ }
  }
  if (!trState.data) return fetchTranscript();
  renderTranscript();
}

async function fetchTranscript() {
  const v = trState.video;
  const btn = $("#tr-refetch");
  btn.disabled = true;
  $("#tr-body").replaceChildren(el("div", { class: "tr-empty" }, "YouTube から字幕を取得しています…"));
  try {
    trState.data = await api("POST", `/api/videos/${encodeURIComponent(v.id)}/transcript`);
    renderTranscript();
  } catch (e) {
    trState.data = null;
    $("#tr-meta").textContent = "";
    const hint = e.status === 429
      ? "YouTube に一時的にブロックされています。時間をおいて再取得してください。"
      : e.status === 422 ? "" : "時間をおいて「再取得」を試してください。";
    $("#tr-body").replaceChildren(el("div", { class: "tr-empty" }, e.message, el("br"), hint));
  } finally {
    btn.disabled = false;
    refreshVideos().catch(() => {});
    refreshChannels().catch(() => {});
  }
}

function renderTranscript() {
  const t = trState.data;
  if (!t) return;
  const kind = t.isTranslated ? "自動翻訳" : t.isGenerated ? "自動生成" : "手動字幕";
  $("#tr-meta").textContent =
    `${t.languageName || t.language}（${kind}）· ${fmtN(t.segments.length)} 行 · ${fmtN([...t.text].length)} 文字 · 取得 ${fmtDateTime(t.fetchedAt)}`;
  const q = $("#tr-q").value.trim().toLowerCase();
  const lines = t.segments.filter((sg) => !q || sg.text.toLowerCase().includes(q));
  if (!lines.length) {
    $("#tr-body").replaceChildren(el("div", { class: "tr-empty" }, "一致する行はありません。"));
    return;
  }
  const highlight = (text) => {
    if (!q) return [text];
    const out = [];
    let i = 0;
    const lower = text.toLowerCase();
    for (let j = lower.indexOf(q); j >= 0; j = lower.indexOf(q, i)) {
      out.push(text.slice(i, j), el("mark", {}, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    out.push(text.slice(i));
    return out;
  };
  const vid = encodeURIComponent(trState.video.id);
  $("#tr-body").replaceChildren(...lines.map((sg) =>
    el("div", { class: "tr-line" },
      el("a", { href: `https://www.youtube.com/watch?v=${vid}&t=${Math.floor(sg.start)}s`, target: "_blank", rel: "noopener", title: "この位置から再生" }, fmtClock(sg.start)),
      el("span", {}, ...highlight(sg.text)))));
}

// ── settings ────────────────────────────────────────────
function openSettings() {
  const s = state.status || {};
  $("#set-key").value = "";
  $("#set-limit").value = s.dailyLimit || 10000;
  $("#set-key-hint").textContent =
    s.apiKeySource === "env" ? "環境変数 YOUTUBE_API_KEY が設定されているため、そちらが優先されます（ここで入力したキーは使われません）。キーを変えるには環境変数を変更してアプリを再起動してください。"
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

  $("#exp-tr").addEventListener("change", updateExportLinks);
  $("#tr-close").addEventListener("click", () => $("#tr-dialog").close());
  $("#tr-refetch").addEventListener("click", fetchTranscript);
  $("#tr-q").addEventListener("input", renderTranscript);
  $("#tr-copy").addEventListener("click", async () => {
    if (!trState.data) return;
    try {
      await navigator.clipboard.writeText(trState.data.text);
      toast("字幕の全文をコピーしました");
    } catch {
      toast("コピーできませんでした", true);
    }
  });
  $("#settings-form").addEventListener("submit", (ev) => {
    if (ev.submitter?.value === "save") saveSettings();
  });

  reloadAll().then(() => {
    if (!state.status.apiKeySource) openSettings();
  }).catch(toastErr);
  pollJobs();
}

init();
