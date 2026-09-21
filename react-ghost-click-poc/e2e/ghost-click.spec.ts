import { test, expect, type Page } from "@playwright/test";
import { STRATEGIES, TIME_GUARD_MS, SHIELD_TIMEOUT_MS, DEFER_TIMEOUT_MS } from "../src/strategies";
import { INITIAL_PARTS } from "../src/types";

const PART_A = INITIAL_PARTS[0];
const MAX_GUARD_MS = Math.max(TIME_GUARD_MS, SHIELD_TIMEOUT_MS, DEFER_TIMEOUT_MS);

async function open(page: Page, strategyId: string) {
  await page.goto(`/?strategy=${strategyId}`);
  await expect(page.getByTestId("strategy")).toHaveValue(strategyId);
  await expect(page.getByTestId("parts-count")).toHaveText(String(INITIAL_PARTS.length));
}

/** canvas 上のパーツ A の中心 (viewport 座標) */
async function partCenter(page: Page) {
  const box = await page.getByTestId("parts-canvas").boundingBox();
  if (!box) throw new Error("canvas not found");
  return { x: box.x + PART_A.x + PART_A.w / 2, y: box.y + PART_A.y + PART_A.h / 2 };
}

const FIXES = STRATEGIES.filter((s) => s.id !== "none");

test.describe("touch (ghost click)", () => {
  test.skip(({ hasTouch }) => !hasTouch, "タッチ端末のみ");

  test("0. 対策なし: タップ直後にダイアログの「削除」が ghost click される", async ({ page }) => {
    await open(page, "none");
    const { x, y } = await partCenter(page);

    await page.touchscreen.tap(x, y);

    // ダイアログは開くが、ユーザーが押していない「削除」が実行されている
    await expect(page.getByTestId("delete-count")).toHaveText("1");
    await expect(page.getByTestId("ghost-count")).toHaveText("1");
    await expect(page.getByTestId("parts-count")).toHaveText(String(INITIAL_PARTS.length - 1));
    await expect(page.getByTestId("part-dialog")).toBeHidden();

    const log = await page.getByTestId("event-log").innerText();
    expect(log).toMatch(/pointerup touch → canvas/);
    expect(log).toMatch(/click touch → dialog-delete.*ghost click/);
  });

  for (const s of FIXES) {
    test(`${s.label}: ghost click が「削除」を実行しない`, async ({ page }) => {
      await open(page, s.id);
      const { x, y } = await partCenter(page);

      await page.touchscreen.tap(x, y);

      // 遅延型の対策があるのでダイアログが開くまで待つ
      const dialog = page.getByTestId("part-dialog");
      await expect(dialog).toBeVisible();
      // ghost click が処理される猶予を与えてから断定する
      await page.waitForTimeout(MAX_GUARD_MS + 100);

      await expect(page.getByTestId("delete-count")).toHaveText("0");
      await expect(page.getByTestId("parts-count")).toHaveText(String(INITIAL_PARTS.length));
      await expect(dialog).toBeVisible();
    });

    test(`${s.label}: 本物のタップで「削除」は動く`, async ({ page }) => {
      await open(page, s.id);
      const { x, y } = await partCenter(page);
      await page.touchscreen.tap(x, y);
      const dialog = page.getByTestId("part-dialog");
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(MAX_GUARD_MS + 100);

      await page.getByTestId("delete").tap();

      await expect(page.getByTestId("delete-count")).toHaveText("1");
      await expect(page.getByTestId("parts-count")).toHaveText(String(INITIAL_PARTS.length - 1));
      await expect(dialog).toBeHidden();
    });

    test(`${s.label}: 本物のタップで「キャンセル」は動く`, async ({ page }) => {
      await open(page, s.id);
      const { x, y } = await partCenter(page);
      await page.touchscreen.tap(x, y);
      const dialog = page.getByTestId("part-dialog");
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(MAX_GUARD_MS + 100);

      await page.getByTestId("cancel").tap();

      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("delete-count")).toHaveText("0");
      await expect(page.getByTestId("parts-count")).toHaveText(String(INITIAL_PARTS.length));
    });
  }
});

test.describe("mouse (regression)", () => {
  test.skip(({ hasTouch }) => hasTouch, "マウス環境のみ");

  for (const s of STRATEGIES) {
    test(`${s.label}: マウスでも開いて削除できる`, async ({ page }) => {
      await open(page, s.id);
      const { x, y } = await partCenter(page);

      await page.mouse.click(x, y);

      const dialog = page.getByTestId("part-dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("delete-count")).toHaveText("0");
      await expect(page.getByTestId("ghost-count")).toHaveText("0");

      await page.waitForTimeout(MAX_GUARD_MS + 100);
      await page.getByTestId("delete").click();

      await expect(page.getByTestId("delete-count")).toHaveText("1");
      await expect(page.getByTestId("parts-count")).toHaveText(String(INITIAL_PARTS.length - 1));
      await expect(dialog).toBeHidden();
    });
  }
});
