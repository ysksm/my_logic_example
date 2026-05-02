import { test, expect } from "@playwright/test";
import { Designer } from "./helpers";

test.describe("pattern derivation", () => {
  test("singleton always becomes P5", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await d.toggleSingleton(true);
    await d.derive();
    await d.expectPattern("Sample", "P5");

    const card = await d.planCardFor("Sample");
    await expect(card.locator(".reason")).toContainText("isSingleton");
  });

  test("adding a child entity flips the pattern to P3", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await d.addChildEntity("Comment");
    await d.selectChildrenForRoot(["Comment"]);

    await d.derive();
    await d.expectPattern("Sample", "P3");
  });

  test("explicit uiHint overrides automatic selection", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await d.setUIHintPattern("P4");
    await d.derive();
    await d.expectPattern("Sample", "P4");

    const card = await d.planCardFor("Sample");
    await expect(card.locator(".reason")).toContainText("uiHint");
  });

  test("threshold change flips P1 to P2 without modifying the model", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    // Default: 1 field → P1 (≤5 small limit)
    await d.derive();
    await d.expectPattern("Sample", "P1");

    // Lower SmallFormFieldLimit to 0 → 1 > 0, so P2.
    await d.setSmallLimit(0);
    await d.derive();
    await d.expectPattern("Sample", "P2");
  });

  test("derive renders concrete screen mocks with fields and buttons", async ({ page }) => {
    const d = new Designer(page);
    await d.open();
    await d.derive();

    const card = await d.planCardFor("Sample");
    // P1 = list + modal: at least 2 screen-cards expected.
    await expect(card.locator(".screen-card")).toHaveCount(2);

    // The list screen has a Table mock.
    await expect(card.locator(".screen-card").first()).toContainText("Sample 一覧");

    // The modal screen has a 保存 button.
    const modal = card.locator(".screen-card").last();
    await expect(modal.locator(".mock-button", { hasText: "保存" })).toBeVisible();
  });
});
