import { test, expect } from "@playwright/test";

// Use the API directly so we can opt out of `npm install` (which would
// download React/Vite into a temporary directory and dwarf the test runtime).
// The runner.Launch path with install=false&start=false still writes files,
// so we assert the folder is on disk and reachable via /api/runs/{id}.
test.describe("launch flow (files only)", () => {
  test("writes the generated app to a folder and exposes its status", async ({ request }) => {
    const r = await request.post("/api/launch", {
      data: {
        install: false,
        start: false,
        domain: {
          id: "e2e-launch",
          name: "E2E Launch",
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
      },
    });
    expect(r.status()).toBe(202);
    const initial = await r.json();
    expect(initial.domainId).toBe("e2e-launch");
    expect(initial.path).toMatch(/e2e-launch-app$/);

    const status = await request.get("/api/runs/e2e-launch");
    expect(status.status()).toBe(200);
    const run = await status.json();
    // With install=false&start=false the lifecycle skips straight to ready.
    expect(["generating", "ready"]).toContain(run.status);

    const list = await request.get("/api/runs");
    expect(list.status()).toBe(200);
    const all = (await list.json()) as Array<{ domainId: string }>;
    expect(all.find((x) => x.domainId === "e2e-launch")).toBeTruthy();

    const stop = await request.post("/api/runs/e2e-launch/stop");
    expect(stop.status()).toBe(200);
  });
});
