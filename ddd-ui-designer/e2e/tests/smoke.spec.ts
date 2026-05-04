import { test, expect } from "@playwright/test";
import { Designer } from "./helpers";

test.describe("smoke", () => {
  test("loads the app shell with the default Sample aggregate", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    // The default seed contains a single Sample aggregate.
    const items = await d.treeItems();
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Sample");

    // Selected by default; the editor shows the Aggregate header.
    await expect(d.centerPane().locator("h2")).toContainText("Sample");

    // Right pane is empty until we hit derive.
    await expect(d.rightPane()).toContainText("導出");
  });

  test("derives a screen plan for the seeded Sample", async ({ page }) => {
    const d = new Designer(page);
    await d.open();
    await d.derive();

    // Sample has 1 field (title) → P1 List+Modal under default thresholds.
    await d.expectPattern("Sample", "P1");

    // The plan card mentions the rule rationale.
    const card = await d.planCardFor("Sample");
    await expect(card.locator(".reason")).toContainText("子なし");
  });
});
