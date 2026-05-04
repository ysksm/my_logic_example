import { useEffect, useRef, useState } from 'react';
import { api, openEventStream } from './api';
import type {
  CDTEvent,
  ConsoleEntry,
  NetworkRequest,
  NetworkResponse,
  PerfSample,
  State,
} from './types';
import { NetworkPanel, type NetRow } from './components/NetworkPanel';
import { ConsolePanel, type ConsoleRow } from './components/ConsolePanel';
import { PerformanceMonitorPanel } from './components/PerformanceMonitorPanel';
import { PerformancePanel } from './components/PerformancePanel';
import { RenderingPanel } from './components/RenderingPanel';

const MAX_NET = 1500;
const MAX_CONSOLE = 1500;
const MAX_PERF_HISTORY = 120;

type Tab = 'network' | 'console' | 'performance' | 'perfMonitor' | 'rendering';

export function App() {
  const [state, setState] = useState<State>({
    running: false,
    attached: false,
    eventCount: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ─── form state (setup view) ────────────────────────────────────────────
  const [url, setUrl] = useState('https://example.com');
  const [headless, setHeadless] = useState(false);
  const [domains, setDomains] = useState({
    network: true,
    console: true,
    performance: true,
  });

  // ─── live view ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('network');
  const [navigateUrl, setNavigateUrl] = useState('');
  const [networkRows, setNetworkRows] = useState<NetRow[]>([]);
  const [consoleRows, setConsoleRows] = useState<ConsoleRow[]>([]);
  const [perfLatest, setPerfLatest] = useState<Record<string, number>>({});
  const perfHistRef = useRef<Record<string, number[]>>({});
  const perfPrevRef = useRef<{ ts: number; m: Record<string, number> } | null>(null);
  const [, forceTick] = useState(0);

  // ─── ws stream ─────────────────────────────────────────────────────────
  useEffect(() => openEventStream(handleEvent), []);

  function handleEvent(ev: CDTEvent) {
    setState((s) => ({ ...s, eventCount: s.eventCount + 1 }));
    switch (ev.kind) {
      case 'network.request': {
        const d = ev.data as NetworkRequest;
        setNetworkRows((rows) =>
          appendCapped(rows, MAX_NET, {
            requestId: d.requestId,
            url: d.url,
            method: d.method,
            type: d.resourceType,
            startedAt: Date.parse(ev.time),
            reqHeaders: d.headers,
          }),
        );
        break;
      }
      case 'network.response': {
        const d = ev.data as NetworkResponse;
        setNetworkRows((rows) =>
          rows.map((r) =>
            r.requestId === d.requestId
              ? { ...r, status: d.status, mimeType: d.mimeType, resHeaders: d.headers }
              : r,
          ),
        );
        break;
      }
      case 'network.finished': {
        const d = ev.data as { requestId: string; encodedDataLength: number };
        setNetworkRows((rows) =>
          rows.map((r) =>
            r.requestId === d.requestId
              ? {
                  ...r,
                  finishedAt: Date.parse(ev.time),
                  encodedDataLength: d.encodedDataLength,
                }
              : r,
          ),
        );
        break;
      }
      case 'network.failed': {
        const d = ev.data as { requestId: string; errorText: string };
        setNetworkRows((rows) =>
          rows.map((r) =>
            r.requestId === d.requestId ? { ...r, failed: d.errorText } : r,
          ),
        );
        break;
      }
      case 'console':
      case 'log':
      case 'exception': {
        const d = ev.data as ConsoleEntry;
        const kind = ev.kind as ConsoleRow['kind'];
        setConsoleRows((rows) =>
          appendCapped(rows, MAX_CONSOLE, {
            time: ev.time,
            level: d.level || (kind === 'exception' ? 'error' : 'log'),
            text: d.text,
            kind,
            url: d.url,
            line: d.line,
          }),
        );
        break;
      }
      case 'perf.monitor': {
        const d = ev.data as PerfSample;
        const m: Record<string, number> = { ...d.metrics };
        // Performance.getMetrics returns cumulative counters; Chrome's
        // Performance Monitor shows rates. Compute deltas against the
        // previous sample.
        const ts = m.Timestamp ?? Date.parse(ev.time) / 1000;
        const prev = perfPrevRef.current;
        if (prev && ts > prev.ts) {
          const dt = ts - prev.ts;
          if (m.TaskDuration !== undefined && prev.m.TaskDuration !== undefined) {
            m.CpuUsage = ((m.TaskDuration - prev.m.TaskDuration) / dt) * 100;
          }
          if (m.LayoutCount !== undefined && prev.m.LayoutCount !== undefined) {
            m.LayoutsPerSec = (m.LayoutCount - prev.m.LayoutCount) / dt;
          }
          if (
            m.RecalcStyleCount !== undefined &&
            prev.m.RecalcStyleCount !== undefined
          ) {
            m.RecalcStylesPerSec =
              (m.RecalcStyleCount - prev.m.RecalcStyleCount) / dt;
          }
        }
        perfPrevRef.current = { ts, m };
        setPerfLatest(m);
        const hist = perfHistRef.current;
        for (const [k, v] of Object.entries(m)) {
          const arr = hist[k] ?? [];
          arr.push(v);
          if (arr.length > MAX_PERF_HISTORY) arr.shift();
          hist[k] = arr;
        }
        forceTick((n) => n + 1);
        break;
      }
    }
  }

  // ─── orchestration ──────────────────────────────────────────────────────

  async function call<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    setBusy(true);
    try {
      return await fn();
    } catch (e: any) {
      setError(String(e?.message ?? e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function launchAndInspect() {
    const s1 = await call(() => api.launch({ url, headless }));
    if (!s1) return;
    const s2 = await call(() =>
      api.start({
        targetIndex: 0,
        network: domains.network,
        console: domains.console,
        performance: domains.performance,
        perfIntervalMs: 1000,
      }),
    );
    setState(s2 ?? s1);
  }

  async function stopAll() {
    await call(() => api.stop());
    const s = await call(() => api.shutdown());
    if (s) setState(s);
    // Keep collected data so the user can still inspect it after stopping.
  }

  async function navigateTo() {
    const target = navigateUrl.trim();
    if (!target) return;
    // Re-attach with navigate URL — simplest path that doesn't need a new endpoint.
    await call(() => api.stop());
    await call(() =>
      api.start({
        targetIndex: 0,
        navigateUrl: target,
        network: domains.network,
        console: domains.console,
        performance: domains.performance,
        perfIntervalMs: 1000,
      }),
    );
    setNavigateUrl('');
  }

  async function snapshot() {
    const m = await call(() => api.snapshot());
    if (m) setPerfLatest(m.metrics);
  }

  // ─── render ─────────────────────────────────────────────────────────────

  if (!state.attached && !state.browserPath) {
    return (
      <Setup
        url={url}
        setUrl={setUrl}
        headless={headless}
        setHeadless={setHeadless}
        domains={domains}
        setDomains={setDomains}
        onLaunch={launchAndInspect}
        busy={busy}
        error={error}
      />
    );
  }

  return (
    <div className="app live">
      <div className="topbar">
        <span className={`status-dot ${state.attached ? 'live' : 'idle'}`} />
        <span className="dim">chromium</span>
        <span className="dim">·</span>
        <input
          className="addr"
          placeholder="navigate to URL…"
          value={navigateUrl}
          onChange={(e) => setNavigateUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigateTo();
          }}
        />
        <button onClick={navigateTo} disabled={busy}>
          Go
        </button>
        <span className="dim sep">·</span>
        <span className="dim">events {state.eventCount}</span>
        {state.targetUrl && (
          <span className="dim trunc" title={state.targetUrl}>
            {state.targetUrl}
          </span>
        )}
        <span className="spacer" />
        <button className="btn-danger" onClick={stopAll} disabled={busy}>
          Stop & Quit
        </button>
        {error && <span className="err">{error}</span>}
      </div>

      <div className="tabbar">
        <button
          className={`tab ${tab === 'network' ? 'active' : ''}`}
          onClick={() => setTab('network')}
        >
          Network <span className="badge">{networkRows.length}</span>
        </button>
        <button
          className={`tab ${tab === 'console' ? 'active' : ''}`}
          onClick={() => setTab('console')}
        >
          Console <span className="badge">{consoleRows.length}</span>
        </button>
        <button
          className={`tab ${tab === 'performance' ? 'active' : ''}`}
          onClick={() => setTab('performance')}
        >
          パフォーマンス
        </button>
        <button
          className={`tab ${tab === 'perfMonitor' ? 'active' : ''}`}
          onClick={() => setTab('perfMonitor')}
        >
          パフォーマンスモニター
        </button>
        <button
          className={`tab ${tab === 'rendering' ? 'active' : ''}`}
          onClick={() => setTab('rendering')}
        >
          レンダリング
        </button>
      </div>

      <div className="tab-host">
        {tab === 'network' && (
          <NetworkPanel rows={networkRows} onClear={() => setNetworkRows([])} />
        )}
        {tab === 'console' && (
          <ConsolePanel rows={consoleRows} onClear={() => setConsoleRows([])} />
        )}
        {tab === 'performance' && <PerformancePanel />}
        {tab === 'perfMonitor' && (
          <PerformanceMonitorPanel
            history={perfHistRef.current}
            latest={perfLatest}
            onSnapshot={snapshot}
          />
        )}
        {tab === 'rendering' && <RenderingPanel />}
      </div>
    </div>
  );
}

// ─── Setup view ───────────────────────────────────────────────────────────

function Setup(props: {
  url: string;
  setUrl: (s: string) => void;
  headless: boolean;
  setHeadless: (b: boolean) => void;
  domains: { network: boolean; console: boolean; performance: boolean };
  setDomains: (d: { network: boolean; console: boolean; performance: boolean }) => void;
  onLaunch: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="setup">
      <div className="card">
        <h1>chrome_dev_tool</h1>
        <p className="dim">
          A fresh Chromium will be launched (downloaded on first run) with
          remote debugging attached. Network, console and performance signals
          stream live into the panels below.
        </p>

        <label className="field">
          <span>URL</span>
          <input
            autoFocus
            value={props.url}
            onChange={(e) => props.setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onLaunch();
            }}
            placeholder="https://example.com"
          />
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={props.headless}
            onChange={(e) => props.setHeadless(e.target.checked)}
          />
          launch headless (no visible window)
        </label>

        <div className="field">
          <span>collect</span>
          <div className="domain-checks">
            {(['network', 'console', 'performance'] as const).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={props.domains[k]}
                  onChange={(e) =>
                    props.setDomains({ ...props.domains, [k]: e.target.checked })
                  }
                />
                {k}
              </label>
            ))}
          </div>
        </div>

        <button
          className="btn-primary big"
          disabled={props.busy || !props.url.trim()}
          onClick={props.onLaunch}
        >
          {props.busy ? 'Launching…' : 'Launch & Inspect'}
        </button>

        {props.error && <div className="err">{props.error}</div>}
      </div>
    </div>
  );
}

function appendCapped<T>(arr: T[], cap: number, item: T): T[] {
  const next = arr.length >= cap ? arr.slice(arr.length - cap + 1) : arr.slice();
  next.push(item);
  return next;
}
