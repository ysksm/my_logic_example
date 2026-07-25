#!/usr/bin/env node
/**
 * Playwright で対象サイトをクロールし、画面遷移図デザイナーで読める
 * screen-flow JSON (ScreenFlowDocument) を生成するサンプルスクリプト。
 *
 * 使い方:
 *   npm run crawl -- http://localhost:5173 [出力ファイル]
 *   MAX_PAGES=30 npm run crawl -- https://example.com crawl-result.json
 *
 * 生成した JSON はアプリの「インポート (マージ)」で既存の図に取り込める。
 * 既存画面は URL でマッチするため、手動で調整した配置や画面名は保持される。
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.argv[2];
const outputPath = process.argv[3] ?? "screen-flow.json";
const maxPages = Number(process.env.MAX_PAGES ?? 20);

if (!baseUrl) {
  console.error("使い方: node playwright/crawl.mjs <ベースURL> [出力ファイル]");
  process.exit(1);
}

const origin = new URL(baseUrl).origin;

/** URL を画面のキーに正規化する (ハッシュ・末尾スラッシュを除去) */
function normalize(url) {
  const parsed = new URL(url);
  let path = `${parsed.pathname}${parsed.search}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

function screenId(path) {
  const slug = path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `pw-${slug || "root"}`;
}

// CHROMIUM_PATH でブラウザ実行ファイルを差し替え可能 (CI やリモート環境向け)
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

const screens = new Map(); // path -> ScreenDef
const transitions = new Map(); // key -> TransitionDef
const queue = [normalize(new URL(baseUrl).href)];
const now = new Date().toISOString();

while (queue.length > 0 && screens.size < maxPages) {
  const path = queue.shift();
  if (screens.has(path)) continue;

  const url = new URL(path, origin).href;
  console.error(`クロール中: ${url}`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (error) {
    console.error(`  スキップ (読み込み失敗): ${error.message}`);
    continue;
  }

  const title = (await page.title()) || path;
  screens.set(path, {
    id: screenId(path),
    name: title,
    url: path,
    discoveredBy: "playwright",
    lastSeenAt: now,
  });

  // 同一オリジンのリンクを収集して遷移として記録する
  const links = await page.$$eval("a[href]", (anchors) =>
    anchors.map((a) => ({
      href: a.href,
      text: (a.textContent ?? "").trim().slice(0, 40),
    })),
  );

  for (const link of links) {
    let target;
    try {
      target = new URL(link.href);
    } catch {
      continue;
    }
    if (target.origin !== origin) continue;

    const targetPath = normalize(target.href);
    if (!screens.has(targetPath) && !queue.includes(targetPath)) {
      queue.push(targetPath);
    }
    if (targetPath === path) continue;

    const selector = `a[href="${target.pathname}${target.search}"]`;
    const key = `${path}->${targetPath}|${selector}`;
    if (!transitions.has(key)) {
      transitions.set(key, {
        id: `pw-t-${transitions.size + 1}`,
        source: screenId(path),
        target: screenId(targetPath),
        trigger: { type: "click", selector, label: link.text || undefined },
        discoveredBy: "playwright",
        lastSeenAt: now,
      });
    }
  }
}

await browser.close();

// クロールしきれなかった遷移先はドキュメントに含めない
const knownIds = new Set([...screens.values()].map((s) => s.id));
const document = {
  version: 1,
  screens: [...screens.values()],
  transitions: [...transitions.values()].filter((t) => knownIds.has(t.target)),
};

writeFileSync(outputPath, JSON.stringify(document, null, 2));
console.error(
  `完了: 画面 ${document.screens.length} 件 / 遷移 ${document.transitions.length} 件 -> ${outputPath}`,
);
