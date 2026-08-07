#!/usr/bin/env node
/**
 * 【実験的】画面遷移マップのデータ生成候補その1。
 *
 * Playwright で対象 SPA を巡回し、ビューアで読める screen-map JSON
 * (ScreenMapDocument, viewer/src/types.ts 参照) とキャプチャ PNG を生成する。
 * データの作成方法はこのスクリプトに限らない — 手書きや他ツールでも、
 * 同じ JSON 形式を出力すればビューアで閲覧できる。
 *
 * 前提 (data-* 規約):
 *   - 遷移を起こす操作可能要素に data-op="<操作ID>" が付いている
 *   - 操作の表示名は data-op-label (省略時は textContent)
 *   - 管理対象の文言要素に data-wording="<文言ID>" が付いている
 *
 * 使い方:
 *   npm run collect -- http://localhost:5175 [出力dir=output]
 *   MAX_PAGES=30 CHROMIUM_PATH=/path/to/chromium node collect.mjs http://localhost:5175
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.argv[2];
const outDir = process.argv[3] ?? "output";
const maxPages = Number(process.env.MAX_PAGES ?? 20);

if (!baseUrl) {
  console.error("使い方: node collect.mjs <ベースURL> [出力dir]");
  process.exit(1);
}

const origin = new URL(baseUrl).origin;
const screenshotDir = join(outDir, "screenshots");
mkdirSync(screenshotDir, { recursive: true });

/** URL を画面キー (パス) に正規化する (ハッシュ・末尾スラッシュを除去) */
function normalize(url) {
  const parsed = new URL(url, origin);
  let path = `${parsed.pathname}${parsed.search}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

function screenId(path) {
  const slug = path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "root";
}

// CHROMIUM_PATH でブラウザ実行ファイルを差し替え可能 (CI やリモート環境向け)
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const screens = new Map(); // path -> Screen
const transitions = new Map(); // key -> Transition
const wordings = new Map(); // wordingId -> Wording
const queue = [normalize(baseUrl)];

async function gotoPath(path) {
  await page.goto(new URL(path, origin).href, {
    waitUntil: "networkidle",
    timeout: 15000,
  });
}

while (queue.length > 0 && screens.size < maxPages) {
  const path = queue.shift();
  if (screens.has(path)) continue;

  console.error(`巡回中: ${path}`);
  try {
    await gotoPath(path);
  } catch (error) {
    console.error(`  スキップ (読み込み失敗): ${error.message}`);
    continue;
  }

  const id = screenId(path);
  const title = (await page.title()) || path;
  const screenshot = `screenshots/${id}.png`;
  await page.screenshot({ path: join(outDir, screenshot) });
  screens.set(path, { id, name: title, path, screenshot });

  // data-wording の文言を収集する (同一 ID は複数画面の使用として集約)
  const pageWordings = await page.$$eval("[data-wording]", (elements) =>
    elements.map((el) => ({
      id: el.getAttribute("data-wording") ?? "",
      text: (el.textContent ?? "").trim(),
    })),
  );
  for (const w of pageWordings) {
    if (!w.id) continue;
    const existing = wordings.get(w.id);
    const usage = { screenId: id, selector: `[data-wording="${w.id}"]` };
    if (!existing) {
      wordings.set(w.id, { id: w.id, text: w.text, usages: [usage] });
    } else {
      if (existing.text !== w.text) {
        console.error(
          `  警告: 文言 ${w.id} のテキストが画面間で異なります ("${existing.text}" / "${w.text}")`,
        );
      }
      existing.usages.push(usage);
    }
  }

  // data-op の操作可能要素を列挙し、1 つずつクリックして遷移を観測する
  const ops = await page.$$eval("[data-op]", (elements) =>
    elements.map((el) => ({
      dataOp: el.getAttribute("data-op") ?? "",
      label:
        el.getAttribute("data-op-label") ?? (el.textContent ?? "").trim().slice(0, 40),
      isSubmit:
        (el instanceof HTMLButtonElement && el.type === "submit") ||
        (el instanceof HTMLInputElement && el.type === "submit"),
    })),
  );

  for (const op of ops) {
    if (!op.dataOp) continue;
    const selector = `[data-op="${op.dataOp}"]`;
    try {
      // 各操作ごとに画面を再ロードして、前の操作の影響を受けないようにする
      await gotoPath(path);
      await page.click(selector, { timeout: 3000 });
      await page.waitForFunction(
        (prev) => `${location.pathname}${location.search}` !== prev &&
          `${location.pathname}${location.search}`.replace(/\/$/, "") !== prev,
        path,
        { timeout: 3000 },
      );
    } catch {
      console.error(`  遷移なし: ${selector}`);
      continue;
    }

    const targetPath = normalize(page.url());
    if (targetPath === path) continue;
    console.error(`  遷移発見: ${selector} -> ${targetPath}`);

    if (!screens.has(targetPath) && !queue.includes(targetPath)) {
      queue.push(targetPath);
    }
    const key = `${path}->${targetPath}|${op.dataOp}`;
    if (!transitions.has(key)) {
      transitions.set(key, {
        id: `t-${transitions.size + 1}`,
        from: id,
        to: screenId(targetPath),
        operation: {
          actionType: op.isSubmit ? "submit" : "click",
          dataOp: op.dataOp,
          selector,
          label: op.label || undefined,
        },
      });
    }
  }
}

await browser.close();

// 巡回しきれなかった遷移先はドキュメントに含めない
const knownIds = new Set([...screens.values()].map((s) => s.id));
const doc = {
  version: 1,
  meta: {
    title: new URL(baseUrl).host,
    generatedAt: new Date().toISOString(),
    generator: "collector",
  },
  screens: [...screens.values()],
  transitions: [...transitions.values()].filter((t) => knownIds.has(t.to)),
  wordings: [...wordings.values()],
};

writeFileSync(join(outDir, "screen-map.json"), JSON.stringify(doc, null, 2));
console.error(
  `完了: 画面 ${doc.screens.length} 件 / 遷移 ${doc.transitions.length} 件 / 文言 ${doc.wordings.length} 件 -> ${join(outDir, "screen-map.json")}`,
);
