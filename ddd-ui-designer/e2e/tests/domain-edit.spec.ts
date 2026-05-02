import { test, expect } from "@playwright/test";
import { Designer } from "./helpers";

test.describe("domain editing", () => {
  test("adds, renames and removes an aggregate", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await d.addAggregate();
    let items = await d.treeItems();
    await expect(items).toHaveCount(2);

    // The newly added aggregate is selected.
    await expect(d.centerPane().locator("h2")).toContainText("Aggregate2");

    await d.setAggregateName("Customer");
    items = await d.treeItems();
    await expect(items).toContainText(["Sample", "Customer"]);

    await d.removeAggregate("Customer");
    items = await d.treeItems();
    await expect(items).toHaveCount(1);
    await expect(items).toContainText(["Sample"]);
  });

  test("adds primitive and enum fields to the root entity", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await d.addRootField("description", "text");
    await d.addRootField("status", "enum");

    // Field rows show: name input + type select + (varies)
    const rows = d.centerPane().locator(".field-row");
    // Root has: existing 1 (title) + 2 new = 3
    await expect(rows).toHaveCount(3);
  });
});
