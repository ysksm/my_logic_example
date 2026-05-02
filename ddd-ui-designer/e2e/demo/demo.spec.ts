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
async function shot(page: any, label: string) {
  step += 1;
  const safe = label.replace(/[^a-z0-9-]/gi, "_");
  await page.screenshot({
    path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${safe}.png`),
    fullPage: false,
  });
}

async function pause(page: any, ms: number) {
  await page.waitForTimeout(ms);
}

test("ddd-ui-designer end-to-end demo", async ({ page }) => {
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
});
