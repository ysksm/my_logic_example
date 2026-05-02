import { test, expect } from "@playwright/test";
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

async function widenRightPane(page: any) {
  await page.evaluate(() => {
    const layout = document.querySelector(".layout") as HTMLElement | null;
    if (layout) {
      layout.dataset.origCols = layout.style.gridTemplateColumns || "";
      layout.style.gridTemplateColumns = "260px 320px 1fr";
    }
  });
}
async function restoreRightPane(page: any) {
  await page.evaluate(() => {
    const layout = document.querySelector(".layout") as HTMLElement | null;
    if (layout) {
      layout.style.gridTemplateColumns = layout.dataset.origCols ?? "";
    }
  });
}

test.setTimeout(180_000);

test("ddd-ui-designer end-to-end demo", async ({ page, context }) => {
  step = 0;
  const d = new Designer(page);

  // ── 1. Open the designer ────────────────────────────────────────────────
  await d.open();
  await pause(page, 600);
  await shot(page, "app-loaded");

  // ── 2. Show that the seed Sample aggregate yields P1 (list + modal) ────
  await d.derive();
  await pause(page, 600);
  await shot(page, "default-derive-P1");

  // ── 3. Rename Sample → Tag and add a couple of small primitive fields ─
  await d.setAggregateName("Tag");
  await d.addRootField("color", "string");
  await pause(page, 400);
  await shot(page, "edit-fields");

  await d.derive();
  await shot(page, "after-edit-still-P1");

  // ── 4. Add a heavier aggregate to demonstrate P2 (list + detail) ────────
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
  await shot(page, "article-fields");

  await d.derive();
  await pause(page, 400);
  await d.expectPattern("Article", "P2");
  await shot(page, "article-derive-P2");

  // ── 5. Convert Article into an aggregate with children → P3 master/detail
  await d.addChildEntity("Comment");
  await d.selectChildrenForRoot(["Comment"]);
  await d.derive();
  await pause(page, 400);
  await d.expectPattern("Article", "P3");
  await shot(page, "article-with-children-P3");

  // ── 6. Force the wizard pattern via uiHint ─────────────────────────────
  await d.setUIHintPattern("P4");
  await d.derive();
  await d.expectPattern("Article", "P4");
  await shot(page, "article-wizard-P4");

  // Reset to auto so the rest of the demo is rule-driven again.
  await d.setUIHintPattern("");

  // ── 7. Add a Singleton aggregate → P5 ───────────────────────────────────
  await d.addAggregate();
  await d.setAggregateName("Settings");
  await d.toggleSingleton(true);
  await d.derive();
  await d.expectPattern("Settings", "P5");
  await shot(page, "settings-P5");

  // ── 8. Threshold experiment: lower small-form limit; Tag flips to P2 ────
  await d.leftPane().locator(".tree-item", { hasText: "Tag" }).click();
  await d.setSmallLimit(0);
  await d.derive();
  await d.expectPattern("Tag", "P2");
  await shot(page, "threshold-flips-P2");

  // ── 9. Persist the demo domain ─────────────────────────────────────────
  await d.setDomainMeta("e2e-demo", "E2E Demo Domain");
  await d.topbar().getByRole("button", { name: "保存" }).click();
  await pause(page, 400);
  await shot(page, "saved");

  // ── 10. Final overview ─────────────────────────────────────────────────
  await d.setFilterSelectedOnly(false);
  await d.derive();
  await pause(page, 600);
  await shot(page, "overview");

  // Sanity: the right pane lists 3 aggregates (Tag, Article, Settings)
  await expect(d.rightPane().locator(".plan-card")).toHaveCount(3);

  // ── 10b. Switch to the screen-flow diagram view ───────────────────────
  // Widen the right pane and viewport temporarily so the SVG isn't clipped.
  await page.setViewportSize({ width: 2000, height: 900 });
  await widenRightPane(page);
  await page.getByTestId("tab-flow").click();
  await pause(page, 600);
  await shot(page, "view-flow-diagram");

  // ── 10c. Switch to the domain ER diagram view ─────────────────────────
  await page.getByTestId("tab-er").click();
  await pause(page, 600);
  await shot(page, "view-er-diagram");

  // Restore layout.
  await restoreRightPane(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("tab-preview").click();
  await pause(page, 400);

  // ── 11. 🚀 生成 → 実行: launch the generated React app ────────────────
  await d.topbar().getByRole("button", { name: /生成 → 実行/ }).click();
  // The RunPanel appears with the initial "generating" / "installing" status.
  const panel = page.getByTestId("run-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });
  await pause(page, 600);
  await shot(page, "launch-clicked");

  // npm install kicks in the first time; allow up to 120s.
  await expect(panel).toHaveAttribute("data-status", "ready", { timeout: 120_000 });
  await pause(page, 600);
  await shot(page, "launch-ready");

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
  await shot(generated, "running-app-home");

  // The running app should expose nav buttons for each Aggregate.
  await expect(generated.locator(".topnav button", { hasText: "Tag" })).toBeVisible();
  await expect(generated.locator(".topnav button", { hasText: "Article" })).toBeVisible();
  await expect(generated.locator(".topnav button", { hasText: "Settings" })).toBeVisible();

  // ── 13. Drive the running app: P5 Settings form ───────────────────────
  await generated.locator(".topnav button", { hasText: "Settings" }).click();
  await pause(generated, 400);
  await shot(generated, "running-app-settings");

  await generated.locator('label.field:has-text("name") input').fill("Acme Industries");
  await pause(generated, 200);
  await generated.locator(".btn", { hasText: "保存" }).click();
  await pause(generated, 400);
  await shot(generated, "running-app-settings-saved");

  // ── 14. Drive Tag (P2 list+detail+edit) ────────────────────────────────
  await generated.locator(".topnav button", { hasText: "Tag" }).click();
  await pause(generated, 400);
  await shot(generated, "running-app-tag-list");

  await generated.locator(".btn", { hasText: "新規作成" }).click();
  await pause(generated, 300);
  await generated.locator('label.field:has-text("title") input').fill("react");
  await generated.locator('label.field:has-text("color") input').fill("#3b82f6");
  await generated.locator(".btn", { hasText: "保存" }).click();
  await pause(generated, 400);
  await generated.locator(".btn-cancel", { hasText: "戻る" }).click();
  await pause(generated, 300);
  await expect(generated.locator(".data-table tbody tr")).toHaveCount(1);
  await shot(generated, "running-app-tag-saved");

  // ── 15. Stop the running app from the designer panel ───────────────────
  await generated.close();
  await page.bringToFront();
  await panel.getByRole("button", { name: /停止/ }).click();
  await expect(panel).toHaveAttribute("data-status", "stopped", { timeout: 5_000 });
  await pause(page, 400);
  await shot(page, "launch-stopped");
});
