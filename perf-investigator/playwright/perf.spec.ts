import { test, expect, chromium } from '@playwright/test';
import { spawn, ChildProcess } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

// End-to-end perf check that runs Playwright + perf-investigator together.
// Playwright launches Chromium with --remote-debugging-port; the Go CLI
// (`pi-cli watch`) attaches and records into ./recordings.
//
// Set PI_CLI to override the binary location.

const PORT = Number(process.env.CDP_PORT ?? 9333);
const CLI = process.env.PI_CLI ?? 'pi-cli';

let watcher: ChildProcess | undefined;

test.beforeAll(async () => {
  watcher = spawn(
    CLI,
    ['watch', '-port', String(PORT), '-source', 'chromedp', '-record', './recordings'],
    { stdio: 'inherit' },
  );
});

test.afterAll(async () => {
  watcher?.kill('SIGINT');
});

test('homepage performs within budget', async () => {
  const browser = await chromium.launch({
    args: [`--remote-debugging-port=${PORT}`],
  });
  const page = await browser.newPage();
  await wait(400);

  const start = Date.now();
  await page.goto('https://example.com', { waitUntil: 'load' });
  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(5_000);

  // Use any in-page measurement you like; perf-investigator captures the
  // CDP-side metrics independently.
  const ttfb = await page.evaluate(
    () => performance.getEntriesByType('navigation')[0]?.responseStart ?? 0,
  );
  expect(ttfb).toBeGreaterThan(0);

  await browser.close();
});
