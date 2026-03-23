#!/usr/bin/env node

const CDP = require('chrome-remote-interface');
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

program
  .name('cdp-cli')
  .description('Chrome DevTools Protocol CLI tool')
  .option('-H, --host <host>', 'CDP host', 'localhost')
  .option('-p, --port <port>', 'CDP port', '9222');

program
  .command('list')
  .description('List open tabs/pages')
  .action(async () => {
    const opts = program.opts();
    try {
      const targets = await CDP.List({ host: opts.host, port: parseInt(opts.port) });
      targets.forEach((t, i) => {
        console.log(`[${i}] ${t.type}: ${t.title} - ${t.url}`);
      });
    } catch (err) {
      console.error('Connection failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('navigate <url>')
  .description('Navigate current tab to URL')
  .action(async (url) => {
    const opts = program.opts();
    let client;
    try {
      client = await CDP({ host: opts.host, port: parseInt(opts.port) });
      const { Page } = client;
      await Page.enable();
      await Page.navigate({ url });
      await Page.loadEventFired();
      console.log(`Navigated to: ${url}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) await client.close();
    }
  });

program
  .command('screenshot [filename]')
  .description('Take a screenshot')
  .action(async (filename) => {
    const opts = program.opts();
    let client;
    try {
      client = await CDP({ host: opts.host, port: parseInt(opts.port) });
      const { Page } = client;
      await Page.enable();
      const { data } = await Page.captureScreenshot({ format: 'png' });
      const out = filename || `screenshot-${Date.now()}.png`;
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
      console.log(`Screenshot saved: ${out}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) await client.close();
    }
  });

program
  .command('eval <expression>')
  .description('Evaluate JavaScript expression in the page')
  .action(async (expression) => {
    const opts = program.opts();
    let client;
    try {
      client = await CDP({ host: opts.host, port: parseInt(opts.port) });
      const { Runtime } = client;
      await Runtime.enable();
      const result = await Runtime.evaluate({ expression, returnByValue: true });
      if (result.exceptionDetails) {
        console.error('Exception:', result.exceptionDetails.text);
      } else {
        console.log(JSON.stringify(result.result.value, null, 2));
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) await client.close();
    }
  });

program
  .command('perf-trace')
  .description('Record a performance trace: start tracing, navigate to URL, wait, then stop')
  .requiredOption('-u, --url <url>', 'URL to navigate to')
  .option('-d, --duration <seconds>', 'Duration to record in seconds', '5')
  .option('-o, --output <file>', 'Output trace file', 'trace.json')
  .option('-s, --serve [port]', 'Start HTTP server to download trace file after recording')
  .action(async (cmdOpts) => {
    const opts = program.opts();
    let client;
    try {
      client = await CDP({ host: opts.host, port: parseInt(opts.port) });
      const { Page, Tracing } = client;
      await Page.enable();

      const traceEvents = [];

      Tracing.dataCollected(({ value }) => {
        traceEvents.push(...value);
      });

      // Start tracing with standard performance categories
      console.log('Starting performance trace...');
      await Tracing.start({
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

      // Navigate to URL
      console.log(`Navigating to: ${cmdOpts.url}`);
      await Page.navigate({ url: cmdOpts.url });
      await Page.loadEventFired();
      console.log('Page loaded.');

      // Wait for specified duration
      const duration = parseInt(cmdOpts.duration);
      console.log(`Recording for ${duration} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, duration * 1000));

      // Stop tracing
      console.log('Stopping trace...');
      const traceComplete = new Promise((resolve) => {
        Tracing.tracingComplete(resolve);
      });
      await Tracing.end();
      await traceComplete;

      // Save trace file (Chrome-compatible format)
      const traceData = { traceEvents };
      fs.writeFileSync(cmdOpts.output, JSON.stringify(traceData));
      console.log(`Trace saved: ${cmdOpts.output} (${traceEvents.length} events)`);
      console.log(`Open in Chrome: chrome://tracing or DevTools Performance tab`);

      if (cmdOpts.serve !== undefined) {
        const servePort = parseInt(cmdOpts.serve) || 8080;
        startFileServer(cmdOpts.output, servePort);
        return; // keep process alive for server
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) await client.close();
    }
  });

program
  .command('network <url>')
  .description('Navigate to URL and log network requests')
  .option('-d, --duration <seconds>', 'Duration to record', '5')
  .action(async (url, cmdOpts) => {
    const opts = program.opts();
    let client;
    try {
      client = await CDP({ host: opts.host, port: parseInt(opts.port) });
      const { Page, Network } = client;
      await Page.enable();
      await Network.enable();

      const requests = [];
      Network.requestWillBeSent(({ request, type }) => {
        requests.push({ url: request.url, method: request.method, type });
      });

      console.log(`Navigating to: ${url}`);
      await Page.navigate({ url });
      await Page.loadEventFired();

      const duration = parseInt(cmdOpts.duration);
      console.log(`Collecting network requests for ${duration}s...`);
      await new Promise((r) => setTimeout(r, duration * 1000));

      console.log(`\n${requests.length} requests captured:\n`);
      requests.forEach((r, i) => {
        console.log(`  [${i}] ${r.method} ${r.type || ''} ${r.url.substring(0, 120)}`);
      });
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) await client.close();
    }
  });

program
  .command('console <url>')
  .description('Navigate to URL and capture console messages')
  .option('-d, --duration <seconds>', 'Duration to capture', '5')
  .action(async (url, cmdOpts) => {
    const opts = program.opts();
    let client;
    try {
      client = await CDP({ host: opts.host, port: parseInt(opts.port) });
      const { Page, Runtime } = client;
      await Page.enable();
      await Runtime.enable();

      Runtime.consoleAPICalled(({ type, args }) => {
        const text = args.map((a) => a.value || a.description || '').join(' ');
        console.log(`[${type}] ${text}`);
      });

      console.log(`Navigating to: ${url}`);
      await Page.navigate({ url });

      const duration = parseInt(cmdOpts.duration);
      await new Promise((r) => setTimeout(r, duration * 1000));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) await client.close();
    }
  });

program
  .command('download <url>')
  .description('Download a file from URL and save locally')
  .option('-o, --output <file>', 'Output filename')
  .action(async (url, cmdOpts) => {
    const output = cmdOpts.output || path.basename(new URL(url).pathname) || 'download.json';
    console.log(`Downloading: ${url}`);
    try {
      await downloadFile(url, output);
      const size = fs.statSync(output).size;
      console.log(`Saved: ${output} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      console.error('Download failed:', err.message);
      process.exit(1);
    }
  });

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      let downloaded = 0;
      const total = parseInt(res.headers['content-length'] || '0');
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = ((downloaded / total) * 100).toFixed(0);
          process.stdout.write(`\r  Progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        if (total > 0) process.stdout.write('\n');
        resolve();
      });
      file.on('error', (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    }).on('error', reject);
  });
}

program
  .command('serve [file]')
  .description('Start HTTP server to download trace/data files')
  .option('--port <port>', 'Server port', '8080')
  .action(async (file, cmdOpts) => {
    const target = file || 'trace.json';
    startFileServer(target, parseInt(cmdOpts.port));
  });

function startFileServer(filePath, port) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const fileName = path.basename(absPath);
  const fileSize = fs.statSync(absPath).size;
  const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);

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
      // Serve a simple HTML page with download link
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html><head><title>CDP CLI - File Download</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:50px auto;text-align:center">
  <h2>CDP CLI - Trace Download</h2>
  <p><a href="/${fileName}" style="font-size:1.3em">Download ${fileName}</a> (${fileSizeMB} MB)</p>
  <p style="color:#666;font-size:0.9em">Open in Chrome: chrome://tracing or DevTools Performance tab</p>
</body></html>`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Trying ${port + 1}...`);
      server.listen(port + 1, '0.0.0.0');
    } else {
      console.error('Server error:', err.message);
      process.exit(1);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    const actualPort = server.address().port;
    console.log(`\nHTTP server started:`);
    console.log(`  Download: http://localhost:${actualPort}/${fileName}`);
    console.log(`  Browser:  http://localhost:${actualPort}/`);
    console.log(`  File:     ${absPath} (${fileSizeMB} MB)`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  });
}

program.parse();
