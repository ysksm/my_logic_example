import { test, expect } from "@playwright/test";
import { Designer } from "./helpers";

test.describe("sample loading", () => {
  test("API exposes the bundled samples", async ({ request }) => {
    const r = await request.get("/api/samples");
    expect(r.status()).toBe(200);
    const samples = await r.json();
    expect(samples.length).toBeGreaterThanOrEqual(3);
    const ids = samples.map((s: any) => s.id).sort();
    expect(ids).toEqual(expect.arrayContaining(["blog", "project", "shop"]));
  });

  test("opening the menu lists samples and clicking one loads it", async ({ page }) => {
    const d = new Designer(page);
    await d.open();

    await page.getByTestId("sample-menu-button").click();
    const menu = page.getByTestId("sample-menu");
    await expect(menu).toBeVisible();

    // Three bundled samples should appear.
    await expect(menu.getByTestId("sample-blog")).toBeVisible();
    await expect(menu.getByTestId("sample-project")).toBeVisible();
    await expect(menu.getByTestId("sample-shop")).toBeVisible();

    // Click "編集に読込" for blog (no server persist).
    await menu.getByTestId("sample-blog-load").click();
    await expect(menu).not.toBeVisible();

    // Topbar id should now be "blog" and tree should list its 4 aggregates.
    await expect(d.topbar().locator('input[placeholder="id"]')).toHaveValue("blog");
    const items = await d.treeItems();
    await expect(items).toContainText(["Post", "Author", "Comment", "BlogSettings"]);
  });

  test("\"読込 + 保存\" persists the sample to storage", async ({ page, request }) => {
    const d = new Designer(page);
    await d.open();

    // Verify project isn't yet in storage.
    const before = await (await request.get("/api/domains")).json();
    expect(before.find((x: any) => x.id === "project")).toBeUndefined();

    await page.getByTestId("sample-menu-button").click();
    await page.getByTestId("sample-project-load-save").click();

    // The list dropdown should now include "Project Management".
    await expect(d.topbar().locator("select").locator("option", { hasText: "Project Management" })).toHaveCount(1);

    const after = await (await request.get("/api/domains")).json();
    expect(after.find((x: any) => x.id === "project")).toBeDefined();
  });
});
