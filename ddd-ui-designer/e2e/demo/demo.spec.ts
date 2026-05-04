import { test, expect, type Page, type Locator } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Designer } from "../tests/helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, "..", "screenshots");

/**
 * `demo.spec.ts` is intentionally not a strict test — it scripts the
 * end-to-end happy path so reviewers can watch the recording in
 * `e2e/test-results/.../video.webm` and skim numbered screenshots in
 * `e2e/screenshots/`.
 *
 * Run with: `npm run demo` (uses the `demo` Playwright project, headed video).
 */

let step = 0;
async function shot(target: any, label: string) {
  step += 1;
  const safe = label.replace(/[^a-z0-9-]/gi, "_");
  await target.screenshot({
    path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${safe}.png`),
    fullPage: false,
  });
}

async function pause(page: any, ms: number) {
  await page.waitForTimeout(ms);
}

/**
 * Show a narration banner + spotlight ring around `target`, leave it on
 * screen for `holdMs`, then clear it. Purely visual — pointer events are
 * disabled so the underlying click in the next step still works.
 */
async function narrate(page: Page, target: Locator, text: string, holdMs = 1200) {
  const handle = await target.elementHandle();
  await page.evaluate(
    ({ el, text }) => {
      document.getElementById("__demo_overlay__")?.remove();
      document.getElementById("__demo_focus__")?.remove();

      const banner = document.createElement("div");
      banner.id = "__demo_overlay__";
      banner.textContent = text;
      Object.assign(banner.style, {
        position: "fixed", bottom: "16px", left: "16px", zIndex: "99999",
        padding: "10px 14px", background: "rgba(17,24,39,.92)",
        color: "#fff", font: "14px/1.4 system-ui, sans-serif",
        borderRadius: "8px", boxShadow: "0 6px 20px rgba(0,0,0,.3)",
        maxWidth: "60vw", pointerEvents: "none",
      } as CSSStyleDeclaration);
      document.body.appendChild(banner);

      if (el) {
        const r = (el as HTMLElement).getBoundingClientRect();
        const ring = document.createElement("div");
        ring.id = "__demo_focus__";
        Object.assign(ring.style, {
          position: "fixed",
          left: `${r.left - 6}px`, top: `${r.top - 6}px`,
          width: `${r.width + 12}px`, height: `${r.height + 12}px`,
          border: "3px solid #f59e0b", borderRadius: "8px",
          boxShadow: "0 0 0 9999px rgba(0,0,0,.25)",
          zIndex: "99998", pointerEvents: "none",
        } as CSSStyleDeclaration);
        document.body.appendChild(ring);
      }
    },
    { el: handle, text },
  );
  await page.waitForTimeout(holdMs);
}

async function clearNarration(page: Page) {
  await page.evaluate(() => {
    document.getElementById("__demo_overlay__")?.remove();
    document.getElementById("__demo_focus__")?.remove();
  });
}

test.setTimeout(180_000);

test("ddd-ui-designer end-to-end demo", async ({ page, context }) => {
  step = 0;
  const d = new Designer(page);

  // ── 1. Open the designer ────────────────────────────────────────────────
  await d.open();
  await pause(page, 600);
  await narrate(page, d.topbar().locator("h1"), "ddd-ui-designer を起動しました", 1200);
  await shot(page, "app-loaded");
  await clearNarration(page);

  // ── 1b. Open the bundled sample menu and load the project sample ────────
  const sampleMenu = page.getByTestId("sample-menu-button");
  await narrate(page, sampleMenu, "📂 サンプルメニューを開きます");
  await sampleMenu.click();
  await pause(page, 400);
  await shot(page, "sample-menu-open");

  const projectLoad = page.getByTestId("sample-project-load");
  await narrate(page, projectLoad, "「プロジェクト管理」サンプルを読み込みます");
  await projectLoad.click();
  await pause(page, 600);
  await shot(page, "sample-project-loaded");
  await clearNarration(page);

  // Derive immediately to show that bundled data lights up all 4 patterns
  // (P4 / P3 / P1 / P5) in one shot.
  await d.setFilterSelectedOnly(false);
  const deriveBtn = d.topbar().getByRole("button", { name: "▶ 画面を導出" });
  await narrate(page, deriveBtn, "▶ 画面を導出 を実行 — 4つのパターンが一気に出るはず", 1500);
  await d.derive();
  await pause(page, 600);
  await shot(page, "sample-project-derived");
  await clearNarration(page);
  await expect(page.locator(".plan-card")).toHaveCount(4);

  // Reset to a clean "Sample" aggregate for the rest of the demo.
  await page.reload();
  await pause(page, 600);

  // ── 2. Show that the seed Sample aggregate yields P1 (list + modal) ────
  await narrate(page, d.topbar().getByRole("button", { name: "▶ 画面を導出" }),
    "デフォルトの Sample 集約は P1 (一覧 + モーダル) になります");
  await d.derive();
  await pause(page, 600);
  await shot(page, "default-derive-P1");
  await clearNarration(page);

  // ── 3. Rename Sample → Tag and add a couple of small primitive fields ─
  const nameInput = d.centerPane().locator('label.row:has-text("名前") input').first();
  await narrate(page, nameInput, "集約名を Sample → Tag にリネーム");
  await d.setAggregateName("Tag");
  await d.addRootField("color", "string");
  await pause(page, 400);
  await shot(page, "edit-fields");
  await clearNarration(page);

  await narrate(page, d.topbar().getByRole("button", { name: "▶ 画面を導出" }),
    "編集後にもう一度 ▶ 画面を導出 — フィールドが少ないので P1 のまま");
  await d.derive();
  await shot(page, "after-edit-still-P1");
  await clearNarration(page);

  // ── 4. Add a heavier aggregate to demonstrate P2 (list + detail) ────────
  const addAggBtn = d.leftPane().getByRole("button", { name: "+ 追加" });
  await narrate(page, addAggBtn, "もう1つ集約を追加 — 重めの Article を作ります");
  await d.addAggregate();
  await d.setAggregateName("Article");
  for (const [name, type] of [
    ["title", "string"],
    ["body", "text"],
    ["author", "string"],
    ["category", "enum"],
    ["tags", "string"],
    ["publishedAt", "date"],
  ] as const) {
    await d.addRootField(name, type);
  }
  await narrate(page, d.centerPane(), "Article に 6 フィールド追加 — 小型フォーム閾値を超えます");
  await shot(page, "article-fields");
  await clearNarration(page);

  await narrate(page, d.topbar().getByRole("button", { name: "▶ 画面を導出" }),
    "再導出 — フィールド数が多いので Article は P2 (一覧 + 詳細画面) に");
  await d.derive();
  await pause(page, 400);
  await d.expectPattern("Article", "P2");
  await shot(page, "article-derive-P2");
  await clearNarration(page);

  // ── 5. Convert Article into an aggregate with children → P3 master/detail
  await narrate(page, d.centerPane(), "Article に子Entity Comment を追加 → 親子をひと画面で扱う P3 へ");
  await d.addChildEntity("Comment");
  await d.selectChildrenForRoot(["Comment"]);
  await d.derive();
  await pause(page, 400);
  await d.expectPattern("Article", "P3");
  await shot(page, "article-with-children-P3");
  await clearNarration(page);

  // ── 6. Force the wizard pattern via uiHint ─────────────────────────────
  const hintSel = d.centerPane().locator('label.row:has-text("Pattern") select').first();
  await narrate(page, hintSel, "uiHint で P4 (ウィザード) を強制指定 — ルールを上書きできます");
  await d.setUIHintPattern("P4");
  await d.derive();
  await d.expectPattern("Article", "P4");
  await shot(page, "article-wizard-P4");
  await clearNarration(page);

  // Reset to auto so the rest of the demo is rule-driven again.
  await d.setUIHintPattern("");

  // ── 7. Add a Singleton aggregate → P5 ───────────────────────────────────
  await narrate(page, d.leftPane().getByRole("button", { name: "+ 追加" }),
    "Singleton 集約 Settings を追加 — 単発フォーム P5 になる予定");
  await d.addAggregate();
  await d.setAggregateName("Settings");
  await d.toggleSingleton(true);
  await d.derive();
  await d.expectPattern("Settings", "P5");
  await shot(page, "settings-P5");
  await clearNarration(page);

  // ── 8. Threshold experiment: lower small-form limit; Tag flips to P2 ────
  const tagItem = d.leftPane().locator(".tree-item", { hasText: "Tag" });
  await narrate(page, tagItem, "Tag に戻り、小型フォーム閾値を 0 に下げて挙動を観察");
  await tagItem.click();
  await d.setSmallLimit(0);
  await d.derive();
  await d.expectPattern("Tag", "P2");
  await shot(page, "threshold-flips-P2");
  await clearNarration(page);

  // ── 9. Persist the demo domain ─────────────────────────────────────────
  const saveBtn = d.topbar().getByRole("button", { name: "保存" });
  await narrate(page, saveBtn, "ドメイン定義を保存 — リロードしても残ります");
  await d.setDomainMeta("e2e-demo", "E2E Demo Domain");
  await saveBtn.click();
  await pause(page, 400);
  await shot(page, "saved");
  await clearNarration(page);

  // ── 10. Final overview ─────────────────────────────────────────────────
  await d.setFilterSelectedOnly(false);
  await narrate(page, d.rightPane(), "全集約を導出 — 3つの集約・3つの異なるパターンが揃いました");
  await d.derive();
  await pause(page, 600);
  await shot(page, "overview");
  await clearNarration(page);

  // Sanity: the right pane lists 3 aggregates (Tag, Article, Settings)
  await expect(d.rightPane().locator(".plan-card")).toHaveCount(3);

  // ── 10b. Switch to 👁 表示モード — the editor pane folds away and the
  //         right pane gets the full remaining width.
  const viewMode = page.getByTestId("mode-view");
  await narrate(page, viewMode, "👁 表示モードへ切替 — 編集ペインを畳んで右ペインを最大化");
  await viewMode.click();
  await pause(page, 400);
  await shot(page, "mode-view-on");
  await clearNarration(page);

  const flowTab = page.getByTestId("tab-flow");
  await narrate(page, flowTab, "画面遷移図タブ — 導出したパターン間の遷移を可視化");
  await flowTab.click();
  await pause(page, 600);
  await shot(page, "view-flow-diagram");
  await clearNarration(page);

  const erTab = page.getByTestId("tab-er");
  await narrate(page, erTab, "ER図タブ — 集約とフィールドからER図を生成");
  await erTab.click();
  await pause(page, 600);
  await shot(page, "view-er-diagram");
  await clearNarration(page);

  // Back to 🛠 設定 mode for the rest of the flow (launch, etc.)
  await page.getByTestId("mode-edit").click();
  await page.getByTestId("tab-preview").click();
  await pause(page, 400);

  // ── 11. 🚀 生成 → 実行: launch the generated React app ────────────────
  const launchBtn = d.topbar().getByRole("button", { name: /生成 → 実行/ });
  await narrate(page, launchBtn, "🚀 生成 → 実行 — React アプリを生成して立ち上げます", 1500);
  await launchBtn.click();
  // The RunPanel appears with the initial "generating" / "installing" status.
  const panel = page.getByTestId("run-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await pause(page, 600);
  await shot(page, "launch-clicked");
  await clearNarration(page);

  // npm install kicks in the first time; allow up to 120s.
  await narrate(page, panel, "npm install + ビルド中… 初回は最大120秒かかります", 1500);
  await expect(panel).toHaveAttribute("data-status", "ready", { timeout: 120_000 });
  await pause(page, 600);
  await shot(page, "launch-ready");
  await clearNarration(page);

  // Pull the URL the runner allocated.
  const link = panel.locator("a[href^='http://localhost:']").first();
  const runUrl = await link.getAttribute("href");
  expect(runUrl).toMatch(/^http:\/\/localhost:\d+/);

  // ── 12. Open the running app in a new tab ──────────────────────────────
  const generated = await context.newPage();
  await generated.setViewportSize({ width: 1280, height: 800 });
  await generated.goto(runUrl!);
  await generated.waitForLoadState("networkidle");
  await pause(generated, 800);
  await narrate(generated, generated.locator(".topnav"),
    "生成された React アプリ — 集約ごとにナビボタンが並びます", 1500);
  await shot(generated, "running-app-home");
  await clearNarration(generated);

  // The running app should expose nav buttons for each Aggregate.
  await expect(generated.locator(".topnav button", { hasText: "Tag" })).toBeVisible();
  await expect(generated.locator(".topnav button", { hasText: "Article" })).toBeVisible();
  await expect(generated.locator(".topnav button", { hasText: "Settings" })).toBeVisible();

  // ── 13. Drive the running app: P5 Settings form ───────────────────────
  const settingsNav = generated.locator(".topnav button", { hasText: "Settings" });
  await narrate(generated, settingsNav, "P5 (Single Form) — Settings は1画面の単発フォーム");
  await settingsNav.click();
  await pause(generated, 400);
  await shot(generated, "running-app-settings");
  await clearNarration(generated);

  const nameField = generated.locator('label.field:has-text("name") input');
  await narrate(generated, nameField, "name に値を入力して保存");
  await nameField.fill("Acme Industries");
  await pause(generated, 200);
  await generated.locator(".btn", { hasText: "保存" }).click();
  await pause(generated, 400);
  await shot(generated, "running-app-settings-saved");
  await clearNarration(generated);

  // ── 14. Drive Tag (P2 list+detail+edit) ────────────────────────────────
  const tagNav = generated.locator(".topnav button", { hasText: "Tag" });
  await narrate(generated, tagNav, "P2 (List + Detail) — Tag は一覧 → 詳細 → 編集の流れ");
  await tagNav.click();
  await pause(generated, 400);
  await shot(generated, "running-app-tag-list");
  await clearNarration(generated);

  const newBtn = generated.locator(".btn", { hasText: "新規作成" });
  await narrate(generated, newBtn, "新規作成 → フォーム入力 → 保存 → 一覧に戻る", 1400);
  await newBtn.click();
  await pause(generated, 300);
  await generated.locator('label.field:has-text("title") input').fill("react");
  await generated.locator('label.field:has-text("color") input').fill("#3b82f6");
  await generated.locator(".btn", { hasText: "保存" }).click();
  await pause(generated, 400);
  await generated.locator(".btn-cancel", { hasText: "戻る" }).click();
  await pause(generated, 300);
  await expect(generated.locator(".data-table tbody tr")).toHaveCount(1);
  await shot(generated, "running-app-tag-saved");
  await clearNarration(generated);

  // ── 15. Stop the running app from the designer panel ───────────────────
  await generated.close();
  await page.bringToFront();
  const stopBtn = panel.getByRole("button", { name: /停止/ });
  await narrate(page, stopBtn, "デザイナー側から停止 — RunPanel が stopped 状態に遷移");
  await stopBtn.click();
  await expect(panel).toHaveAttribute("data-status", "stopped", { timeout: 5_000 });
  await pause(page, 400);
  await shot(page, "launch-stopped");
  await clearNarration(page);
});
