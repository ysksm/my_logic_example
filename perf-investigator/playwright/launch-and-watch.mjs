// Launches Chromium via Playwright with a fixed --remote-debugging-port,
// then spawns `perf-investigator watch` so the Go side records everything
// the Playwright script does.
//
// Usage:
//   node launch-and-watch.mjs https://example.com
//
// Requirements:
//   - The pi-cli binary on $PATH (or set PI_CLI=path/to/pi-cli)
//   - @playwright/test (npm install)

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const URL = process.argv[2] ?? 'https://example.com';
const PORT = Number(process.env.CDP_PORT ?? 9333);
const CLI = process.env.PI_CLI ?? 'pi-cli';

const browser = await chromium.launch({
  headless: false,
  args: [`--remote-debugging-port=${PORT}`],
});
const context = await browser.newContext();
const page = await context.newPage();

// Give Chrome a moment to expose /json before pi-cli attaches.
await wait(400);

const watcher = spawn(
  CLI,
  ['watch', '-port', String(PORT), '-source', 'raw', '-record', './recordings'],
  { stdio: 'inherit' },
);

console.log(`navigating to ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle' });

// Drive your scenario here — interact with the page however you like and
// pi-cli will keep streaming events to ./recordings/pi-YYYY-MM-DD.ndjson.
await page.waitForTimeout(5_000);

await context.close();
await browser.close();
watcher.kill('SIGINT');
