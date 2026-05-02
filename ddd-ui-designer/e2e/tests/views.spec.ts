import { test, expect } from "@playwright/test";
import { Designer } from "./helpers";

test.describe("right-pane views", () => {
  test("ER diagram shows aggregate clusters and entity boxes", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await d.addRootField("color", "string");
    await page.getByTestId("tab-er").click();

    const svg = d.rightPane().locator("svg");
    await expect(svg).toBeVisible();
    // Aggregate header: "◆ Sample" (the seeded aggregate)
    await expect(svg.locator("text", { hasText: /Sample/ }).first()).toBeVisible();
    // Field labels
    await expect(svg.locator("text", { hasText: /title/ }).first()).toBeVisible();
    await expect(svg.locator("text", { hasText: /color/ }).first()).toBeVisible();
  });

  test("flow diagram appears after derive and shows screen ids", async ({ page }) => {
    const d = new Designer(page);
    await d.open();
    await d.derive();

    await page.getByTestId("tab-flow").click();
    const svg = d.rightPane().locator("svg");
    await expect(svg).toBeVisible();
    // The plan generated for Sample under default rules is P1 (list + modal),
    // so we expect both screen ids in the SVG.
    await expect(svg.locator("text", { hasText: "scr_Sample_list" })).toBeVisible();
    await expect(svg.locator("text", { hasText: "scr_Sample_modal" })).toBeVisible();
  });

  test("tab switch is preserved per render and visually distinct", async ({ page }) => {
    const d = new Designer(page);
    await d.open();
    await d.derive();

    // Default tab is preview.
    await expect(d.rightPane().locator(".plan-card").first()).toBeVisible();

    await page.getByTestId("tab-flow").click();
    await expect(d.rightPane().locator("svg")).toBeVisible();
    await expect(d.rightPane().locator(".plan-card")).toHaveCount(0);

    await page.getByTestId("tab-er").click();
    await expect(d.rightPane().locator("svg")).toBeVisible();

    await page.getByTestId("tab-preview").click();
    await expect(d.rightPane().locator(".plan-card").first()).toBeVisible();
  });
});
