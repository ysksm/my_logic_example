#!/usr/bin/env node

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { program } = require('commander');

// ─── File server (reused from other versions) ─────────────────────

function startFileServer(filePath, port) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) { console.error(`File not found: ${absPath}`); process.exit(1); }
  const fileName = path.basename(absPath);
  const fileSize = fs.statSync(absPath).size;
  const sizeMB = (fileSize / 1024 / 1024).toFixed(1);

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === `/${fileName}`) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': fileSize,
      });
      fs.createReadStream(absPath).pipe(res);
      console.log(`  -> Download requested from ${req.socket.remoteAddress}`);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:50px auto;text-align:center">
        <h2>CDP Playwright CLI - Trace Download</h2>
        <p><a href="/${fileName}" style="font-size:1.3em">Download ${fileName}</a> (${sizeMB} MB)</p>
      </body></html>`);
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} in use, trying ${port + 1}...`);
      server.listen(port + 1, '0.0.0.0');
    } else { console.error('Server error:', err.message); process.exit(1); }
  });
  server.listen(port, '0.0.0.0', () => {
    const p = server.address().port;
    console.log(`\nHTTP server started:`);
    console.log(`  Download: http://localhost:${p}/${fileName}`);
    console.log(`  File:     ${absPath} (${sizeMB} MB)`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  });
}

// ─── CLI ──────────────────────────────────────────────────────────

program
  .name('cdp-playwright')
  .description('Chrome DevTools + Playwright CLI')
  .option('-H, --host <host>', 'CDP host', 'localhost')
  .option('-p, --port <port>', 'CDP port', '9222');

program
  .command('yahoo-tabs')
  .description('Open yahoo.co.jp, click through news tabs, and record performance trace')
  .option('-o, --output <file>', 'Output trace file', 'trace.json')
  .option('-s, --serve [port]', 'Start HTTP server after recording')
  .option('--wait <ms>', 'Wait time after each tab click (ms)', '2000')
  .action(async (cmdOpts) => {
    const { host, port } = program.opts();
    const cdpUrl = `http://${host}:${port}`;
    const waitMs = parseInt(cmdOpts.wait);

    const tabs = ['主要', '経済', 'エンタメ', 'スポーツ', '国内', 'IT', '科学'];

    let browser;
    try {
      console.log(`Connecting to Chrome at ${cdpUrl}...`);
      browser = await chromium.connectOverCDP(cdpUrl);

      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      // Start CDP tracing via the page's CDP session
      const cdpSession = await context.newCDPSession(page);
      const traceEvents = [];

      cdpSession.on('Tracing.dataCollected', (params) => {
        traceEvents.push(...params.value);
      });

      console.log('Starting performance trace...');
      await cdpSession.send('Tracing.start', {
        categories: [
          'devtools.timeline',
          'v8.execute',
          'blink.console',
          'blink.user_timing',
          'loading',
          'latencyInfo',
          'devtools.timeline.frame',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'disabled-by-default-devtools.timeline.stack',
          'disabled-by-default-v8.cpu_profiler',
        ].join(','),
        options: 'sampling-frequency=10000',
      });

      // Navigate to yahoo.co.jp
      console.log('Navigating to https://yahoo.co.jp ...');
      await page.goto('https://yahoo.co.jp', { waitUntil: 'load' });
      console.log('Page loaded.');
      await page.waitForTimeout(waitMs);

      // Click through each tab
      for (const tabName of tabs) {
        console.log(`Clicking tab: ${tabName} ...`);
        try {
          // Yahoo's topic tabs are typically anchor/button elements with the tab text
          const tabLocator = page.locator(`a, button, [role="tab"]`).filter({ hasText: tabName }).first();
          await tabLocator.waitFor({ state: 'visible', timeout: 5000 });
          await tabLocator.click();
          await page.waitForTimeout(waitMs);
          console.log(`  -> ${tabName} done`);
        } catch (err) {
          console.log(`  -> ${tabName} not found or not clickable: ${err.message.split('\n')[0]}`);
        }
      }

      // Stop tracing
      console.log('\nStopping trace...');
      const traceComplete = new Promise((resolve) => {
        cdpSession.on('Tracing.tracingComplete', resolve);
      });
      await cdpSession.send('Tracing.end');
      await traceComplete;

      // Save trace
      const traceData = { traceEvents };
      fs.writeFileSync(cmdOpts.output, JSON.stringify(traceData));
      const sizeMB = (fs.statSync(cmdOpts.output).size / 1024 / 1024).toFixed(1);
      console.log(`\nTrace saved: ${cmdOpts.output} (${traceEvents.length} events, ${sizeMB} MB)`);
      console.log('Open in Chrome: chrome://tracing or DevTools Performance tab');

      // Disconnect (don't close the browser)
      browser.close();
      browser = null;

      // Optionally serve
      if (cmdOpts.serve !== undefined) {
        const servePort = parseInt(cmdOpts.serve) || 8080;
        startFileServer(cmdOpts.output, servePort);
        return;
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (browser) browser.close();
    }
  });

program
  .command('perf-trace')
  .description('Record performance trace with Playwright navigation')
  .requiredOption('-u, --url <url>', 'URL to navigate to')
  .option('-d, --duration <seconds>', 'Duration to record', '5')
  .option('-o, --output <file>', 'Output trace file', 'trace.json')
  .option('-s, --serve [port]', 'Start HTTP server after recording')
  .action(async (cmdOpts) => {
    const { host, port } = program.opts();
    const cdpUrl = `http://${host}:${port}`;

    let browser;
    try {
      console.log(`Connecting to Chrome at ${cdpUrl}...`);
      browser = await chromium.connectOverCDP(cdpUrl);

      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      const cdpSession = await context.newCDPSession(page);
      const traceEvents = [];

      cdpSession.on('Tracing.dataCollected', (params) => {
        traceEvents.push(...params.value);
      });

      console.log('Starting performance trace...');
      await cdpSession.send('Tracing.start', {
        categories: [
          'devtools.timeline',
          'v8.execute',
          'blink.console',
          'blink.user_timing',
          'loading',
          'latencyInfo',
          'devtools.timeline.frame',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'disabled-by-default-devtools.timeline.stack',
          'disabled-by-default-v8.cpu_profiler',
        ].join(','),
        options: 'sampling-frequency=10000',
      });

      console.log(`Navigating to: ${cmdOpts.url}`);
      await page.goto(cmdOpts.url, { waitUntil: 'load' });
      console.log('Page loaded.');

      const duration = parseInt(cmdOpts.duration);
      console.log(`Recording for ${duration} seconds...`);
      await page.waitForTimeout(duration * 1000);

      console.log('Stopping trace...');
      const traceComplete = new Promise((resolve) => {
        cdpSession.on('Tracing.tracingComplete', resolve);
      });
      await cdpSession.send('Tracing.end');
      await traceComplete;

      const traceData = { traceEvents };
      fs.writeFileSync(cmdOpts.output, JSON.stringify(traceData));
      const sizeMB = (fs.statSync(cmdOpts.output).size / 1024 / 1024).toFixed(1);
      console.log(`Trace saved: ${cmdOpts.output} (${traceEvents.length} events, ${sizeMB} MB)`);

      browser.close();
      browser = null;

      if (cmdOpts.serve !== undefined) {
        const servePort = parseInt(cmdOpts.serve) || 8080;
        startFileServer(cmdOpts.output, servePort);
        return;
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (browser) browser.close();
    }
  });

program
  .command('screenshot [filename]')
  .description('Take a screenshot with Playwright')
  .option('-u, --url <url>', 'Navigate to URL first')
  .option('--full', 'Full page screenshot')
  .action(async (filename, cmdOpts) => {
    const { host, port } = program.opts();
    let browser;
    try {
      browser = await chromium.connectOverCDP(`http://${host}:${port}`);
      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      if (cmdOpts.url) {
        await page.goto(cmdOpts.url, { waitUntil: 'load' });
      }

      const out = filename || `screenshot-${Date.now()}.png`;
      await page.screenshot({ path: out, fullPage: !!cmdOpts.full });
      console.log(`Screenshot saved: ${out}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (browser) browser.close();
    }
  });

program
  .command('download <url>')
  .description('Download a file from URL and save locally')
  .option('-o, --output <file>', 'Output filename')
  .action(async (url, cmdOpts) => {
    const https = require('https');
    const output = cmdOpts.output || path.basename(new URL(url).pathname) || 'download.json';
    console.log(`Downloading: ${url}`);
    const proto = url.startsWith('https') ? https : http;
    await new Promise((resolve, reject) => {
      proto.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          proto.get(res.headers.location, handler).on('error', reject);
          return;
        }
        handler(res);
        function handler(res) {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          const file = fs.createWriteStream(output);
          let dl = 0;
          const total = parseInt(res.headers['content-length'] || '0');
          res.on('data', (c) => { dl += c.length; if (total) process.stdout.write(`\r  Progress: ${((dl/total)*100).toFixed(0)}%`); });
          res.pipe(file);
          file.on('finish', () => { file.close(); if (total) process.stdout.write('\n'); resolve(); });
        }
      }).on('error', reject);
    });
    const size = fs.statSync(output).size;
    console.log(`Saved: ${output} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  });

program
  .command('serve [file]')
  .description('Start HTTP server to download trace files')
  .option('--port <port>', 'Server port', '8080')
  .action(async (file, cmdOpts) => {
    startFileServer(file || 'trace.json', parseInt(cmdOpts.port));
  });

program.parse();
