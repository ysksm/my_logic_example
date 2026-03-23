#!/usr/bin/env node

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// ─── Raw CDP Client ───────────────────────────────────────────────

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.callbacks = new Map();
    this.eventHandlers = new Map();
  }

  static async connect(host, port, targetIndex = 0) {
    // Fetch target list via HTTP
    const targets = await httpGetJSON(`http://${host}:${port}/json`);
    const pages = targets.filter((t) => t.type === 'page');
    if (pages.length === 0) throw new Error('No page targets found');
    const target = pages[targetIndex] || pages[0];
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client._connect();
    return client;
  }

  _connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id !== undefined && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method) {
          const handlers = this.eventHandlers.get(msg.method) || [];
          handlers.forEach((fn) => fn(msg.params));
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  once(event) {
    return new Promise((resolve) => {
      const handler = (params) => {
        // Remove this handler
        const handlers = this.eventHandlers.get(event);
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
        resolve(params);
      };
      this.on(event, handler);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(dest);
      let downloaded = 0;
      const total = parseInt(res.headers['content-length'] || '0');
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          process.stdout.write(`\r  Progress: ${((downloaded / total) * 100).toFixed(0)}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); if (total > 0) process.stdout.write('\n'); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    }).on('error', reject);
  });
}

// ─── File server ──────────────────────────────────────────────────

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
        <h2>CDP Raw CLI - Trace Download</h2>
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

// ─── CLI commands ─────────────────────────────────────────────────

program
  .name('cdp-raw')
  .description('Chrome DevTools Protocol CLI (raw WebSocket)')
  .option('-H, --host <host>', 'CDP host', 'localhost')
  .option('-p, --port <port>', 'CDP port', '9222');

program
  .command('list')
  .description('List open tabs/pages')
  .action(async () => {
    const { host, port } = program.opts();
    try {
      const targets = await httpGetJSON(`http://${host}:${port}/json`);
      targets.forEach((t, i) => console.log(`[${i}] ${t.type}: ${t.title} - ${t.url}`));
    } catch (err) {
      console.error('Connection failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('navigate <url>')
  .description('Navigate current tab to URL')
  .action(async (url) => {
    const { host, port } = program.opts();
    let client;
    try {
      client = await CDPClient.connect(host, parseInt(port));
      await client.send('Page.enable');
      const loadPromise = client.once('Page.loadEventFired');
      await client.send('Page.navigate', { url });
      await loadPromise;
      console.log(`Navigated to: ${url}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) client.close();
    }
  });

program
  .command('screenshot [filename]')
  .description('Take a screenshot')
  .action(async (filename) => {
    const { host, port } = program.opts();
    let client;
    try {
      client = await CDPClient.connect(host, parseInt(port));
      await client.send('Page.enable');
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      const out = filename || `screenshot-${Date.now()}.png`;
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
      console.log(`Screenshot saved: ${out}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) client.close();
    }
  });

program
  .command('eval <expression>')
  .description('Evaluate JavaScript in the page')
  .action(async (expression) => {
    const { host, port } = program.opts();
    let client;
    try {
      client = await CDPClient.connect(host, parseInt(port));
      await client.send('Runtime.enable');
      const result = await client.send('Runtime.evaluate', { expression, returnByValue: true });
      if (result.exceptionDetails) {
        console.error('Exception:', result.exceptionDetails.text);
      } else {
        console.log(JSON.stringify(result.result.value, null, 2));
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) client.close();
    }
  });

program
  .command('perf-trace')
  .description('Record performance trace: start → navigate → wait → stop → save')
  .requiredOption('-u, --url <url>', 'URL to navigate to')
  .option('-d, --duration <seconds>', 'Duration to record', '5')
  .option('-o, --output <file>', 'Output trace file', 'trace.json')
  .option('-s, --serve [port]', 'Start HTTP server after recording')
  .action(async (cmdOpts) => {
    const { host, port } = program.opts();
    let client;
    try {
      client = await CDPClient.connect(host, parseInt(port));
      await client.send('Page.enable');

      const traceEvents = [];

      // Collect trace data chunks
      client.on('Tracing.dataCollected', (params) => {
        traceEvents.push(...params.value);
      });

      // Start tracing
      console.log('Starting performance trace...');
      await client.send('Tracing.start', {
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

      // Navigate
      console.log(`Navigating to: ${cmdOpts.url}`);
      const loadPromise = client.once('Page.loadEventFired');
      await client.send('Page.navigate', { url: cmdOpts.url });
      await loadPromise;
      console.log('Page loaded.');

      // Wait
      const duration = parseInt(cmdOpts.duration);
      console.log(`Recording for ${duration} seconds...`);
      await new Promise((r) => setTimeout(r, duration * 1000));

      // Stop tracing
      console.log('Stopping trace...');
      const traceComplete = client.once('Tracing.tracingComplete');
      await client.send('Tracing.end');
      await traceComplete;

      // Save
      const traceData = { traceEvents };
      fs.writeFileSync(cmdOpts.output, JSON.stringify(traceData));
      console.log(`Trace saved: ${cmdOpts.output} (${traceEvents.length} events)`);
      console.log('Open in Chrome: chrome://tracing or DevTools Performance tab');

      client.close();
      client = null;

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
      if (client) client.close();
    }
  });

program
  .command('network <url>')
  .description('Navigate to URL and log network requests')
  .option('-d, --duration <seconds>', 'Duration to record', '5')
  .action(async (url, cmdOpts) => {
    const { host, port } = program.opts();
    let client;
    try {
      client = await CDPClient.connect(host, parseInt(port));
      await client.send('Page.enable');
      await client.send('Network.enable');

      const requests = [];
      client.on('Network.requestWillBeSent', (params) => {
        requests.push({ url: params.request.url, method: params.request.method, type: params.type });
      });

      console.log(`Navigating to: ${url}`);
      const loadPromise = client.once('Page.loadEventFired');
      await client.send('Page.navigate', { url });
      await loadPromise;

      const duration = parseInt(cmdOpts.duration);
      console.log(`Collecting network requests for ${duration}s...`);
      await new Promise((r) => setTimeout(r, duration * 1000));

      console.log(`\n${requests.length} requests captured:\n`);
      requests.forEach((r, i) => console.log(`  [${i}] ${r.method} ${r.type || ''} ${r.url.substring(0, 120)}`));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      if (client) client.close();
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

program
  .command('serve [file]')
  .description('Start HTTP server to download trace files')
  .option('--port <port>', 'Server port', '8080')
  .action(async (file, cmdOpts) => {
    startFileServer(file || 'trace.json', parseInt(cmdOpts.port));
  });

program.parse();
