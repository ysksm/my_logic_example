import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      // タッチ端末: page.tap() で touchstart/touchend + 互換 click が生成される
      name: "mobile-touch",
      use: { ...devices["Pixel 7"] },
    },
    {
      // マウス: 対策がマウス操作を壊していないことの確認用
      name: "desktop-mouse",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
