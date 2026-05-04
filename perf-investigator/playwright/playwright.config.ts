import { defineConfig } from '@playwright/test';

// We launch Chromium ourselves with --remote-debugging-port so that
// perf-investigator can attach. The test then connects via CDP and runs
// scenarios while the Go side records everything.
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  use: {
    headless: true,
  },
  // Override per-test timeouts as needed.
  timeout: 60_000,
});
