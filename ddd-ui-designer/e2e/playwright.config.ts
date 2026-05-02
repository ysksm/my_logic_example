import { defineConfig, devices } from "@playwright/test";

const UI_PORT = Number(process.env.UI_PORT ?? 5175);
const API_PORT = Number(process.env.API_PORT ?? 8095);
const BASE_URL = `http://localhost:${UI_PORT}`;

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  projects: [
    {
      name: "tests",
      testDir: "tests",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "demo",
      testDir: "demo",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        video: "on",
      },
    },
  ],
  webServer: [
    {
      // Build the Go server once and run the binary; cheaper than `go run`.
      command: "../../ddd-ui-designer/e2e/scripts/start-api.sh",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm --prefix ../ui run dev -- --port " + UI_PORT,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
