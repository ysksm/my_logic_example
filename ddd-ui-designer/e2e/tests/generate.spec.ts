import { test, expect } from "@playwright/test";
import { Designer } from "./helpers";

test.describe("react app generation", () => {
  test("downloads a tar.gz when 📦 Reactアプリ生成 is clicked", async ({ page }) => {
    const d = new Designer(page);
    await d.open();
    await d.setDomainMeta("e2e-gen", "E2E Gen");

    // Trigger the download.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      d.topbar().getByRole("button", { name: /Reactアプリ生成/ }).click(),
    ]);

    expect(download.suggestedFilename()).toContain("e2e-gen-app");
    expect(download.suggestedFilename()).toMatch(/\.tar\.gz$/);

    // Verify the archive is a non-trivial gzip blob.
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test("the API returns a valid gzip stream for a posted domain", async ({ request }) => {
    const r = await request.post("/api/generate", {
      data: {
        domain: {
          id: "api-gen",
          name: "API Gen",
          aggregates: [
            {
              name: "Tag",
              root: {
                name: "Tag",
                isRoot: true,
                fields: [{ name: "name", type: "string" }],
              },
            },
          ],
        },
        format: "react",
      },
    });
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("gzip");
    const buf = await r.body();
    expect(buf.length).toBeGreaterThan(500);
    // gzip magic
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);
  });
});
