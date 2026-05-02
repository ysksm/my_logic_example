import { test, expect } from "@playwright/test";
import { Designer } from "./helpers";

test.describe("mode switch", () => {
  test("toggling 👁 表示 hides the editor pane and lets the right pane breathe", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    const layout = page.locator(".layout");

    // Default mode is "edit".
    await expect(layout).toHaveAttribute("data-mode", "edit");
    await expect(d.centerPane()).toBeVisible();

    // Click 👁 表示 — second pane (editor) should disappear.
    await page.getByTestId("mode-view").click();
    await expect(layout).toHaveAttribute("data-mode", "view");
    await expect(d.centerPane()).not.toBeVisible();

    // The right pane is still visible and now occupies the remaining space.
    await expect(d.rightPane()).toBeVisible();

    // Click 🛠 設定 — editor pane comes back.
    await page.getByTestId("mode-edit").click();
    await expect(layout).toHaveAttribute("data-mode", "edit");
    await expect(d.centerPane()).toBeVisible();
  });

  test("the chosen mode survives a page reload", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await page.getByTestId("mode-view").click();
    await expect(page.locator(".layout")).toHaveAttribute("data-mode", "view");

    await page.reload();
    await expect(page.locator(".layout")).toHaveAttribute("data-mode", "view");

    // Reset for cleanliness.
    await page.getByTestId("mode-edit").click();
  });

  test("aria-pressed reflects the active mode", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    const editBtn = page.getByTestId("mode-edit");
    const viewBtn = page.getByTestId("mode-view");

    await expect(editBtn).toHaveAttribute("aria-pressed", "true");
    await expect(viewBtn).toHaveAttribute("aria-pressed", "false");

    await viewBtn.click();
    await expect(editBtn).toHaveAttribute("aria-pressed", "false");
    await expect(viewBtn).toHaveAttribute("aria-pressed", "true");
  });
});
