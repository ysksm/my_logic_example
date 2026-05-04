import { useEffect, useMemo, useRef, useState } from 'react';
import { api, openEventStream, type StartParams } from './api';
import type {
  ConsoleEntry,
  NetworkRequest,
  NetworkResponse,
  PerfMonitorSample,
  PIEvent,
  State,
} from './types';
import { Sparkline } from './components/Sparkline';

type NetRow = {
  requestId: string;
  source: string;
  url: string;
  method: string;
  type?: string;
  status?: number;
  mimeType?: string;
  failed?: string;
  startedAt: number;
  finishedAt?: number;
  encodedDataLength?: number;
};

const MAX_NET = 1500;
const MAX_CONSOLE = 1000;
const MAX_PERF_HISTORY = 120;
const PERF_KEYS = [
  'JSHeapUsedSize',
  'JSHeapTotalSize',
  'Nodes',
  'LayoutCount',
  'RecalcStyleCount',
  'ScriptDuration',
  'TaskDuration',
  'LayoutDuration',
];

export function App() {
  const [params, setParams] = useState<StartParams>({
    source: 'raw',
    host: 'localhost',
    port: 9222,
    targetIndex: 0,
    navigateUrl: '',
    network: true,
    console: true,
    performance: true,
    perfMonitor: true,
    lifecycle: true,
  });
  const [state, setState] = useState<State>({ running: false, eventCount: 0 });
  const [tab, setTab] = useState<'network' | 'console'>('network');
  const [networkRows, setNetworkRows] = useState<NetRow[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<
    Array<{ time: string; level: string; text: string; source: string }>
  >([]);
  const [perfLatest, setPerfLatest] = useState<Record<string, number>>({});
  const perfHistRef = useRef<Record<string, number[]>>({});
  const [, forceTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Refresh state periodically.
  useEffect(() => {
    const t = setInterval(() => api.state().then(setState).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, []);

  // Stream events.
  useEffect(() => {
    const close = openEventStream((ev) => handleEvent(ev));
    return close;
  }, []);

  function handleEvent(ev: PIEvent) {
    switch (ev.kind) {
      case 'network.request': {
        const d = ev.data as NetworkRequest;
        setNetworkRows((rows) =>
          appendCapped(rows, MAX_NET, {
            requestId: d.requestId,
            source: ev.source,
            url: d.url,
            method: d.method,
            type: d.resourceType,
            startedAt: Date.parse(ev.time),
          }),
        );
        break;
      }
      case 'network.response': {
        const d = ev.data as NetworkResponse;
        setNetworkRows((rows) =>
          rows.map((r) =>
            r.requestId === d.requestId
              ? { ...r, status: d.status, mimeType: d.mimeType }
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
              ? { ...r, finishedAt: Date.parse(ev.time), encodedDataLength: d.encodedDataLength }
              : r,
          ),
        );
        break;
      }
      case 'network.failed': {
        const d = ev.data as { requestId: string; errorText: string };
        setNetworkRows((rows) =>
          rows.map((r) => (r.requestId === d.requestId ? { ...r, failed: d.errorText } : r)),
        );
        break;
      }
      case 'console':
      case 'log':
      case 'exception': {
        const d = ev.data as ConsoleEntry;
        setConsoleEntries((rows) =>
          appendCapped(rows, MAX_CONSOLE, {
            time: ev.time,
            level: d.level,
            text: d.text,
            source: ev.source,
          }),
        );
        break;
      }
      case 'perf.monitor': {
        const d = ev.data as PerfMonitorSample;
        setPerfLatest({ ...d.metrics });
        const hist = perfHistRef.current;
        for (const k of PERF_KEYS) {
          const v = d.metrics[k] ?? 0;
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

  async function start() {
    setError(null);
    try {
      setState(await api.start(params));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }
  async function stop() {
    try {
      setState(await api.stop());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }
  async function snapshot() {
    try {
      const m = await api.snapshot();
      setPerfLatest(m.metrics);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  const counts = useMemo(() => {
    let ok = 0,
      fail = 0;
    for (const r of networkRows) {
      if (r.failed) fail++;
      else if (r.status && r.status >= 200) ok++;
    }
    return { total: networkRows.length, ok, fail };
  }, [networkRows]);

  return (
    <div className="app">
      <header>
        <h1>perf-investigator</h1>

        <label>backend</label>
        <select
          value={params.source}
          onChange={(e) => setParams({ ...params, source: e.target.value as StartParams['source'] })}
        >
          <option value="raw">raw (custom WS)</option>
          <option value="chromedp">chromedp</option>
          <option value="rod">rod</option>
        </select>

        <label>host</label>
        <input
          value={params.host}
          onChange={(e) => setParams({ ...params, host: e.target.value })}
          style={{ width: 100 }}
        />
        <label>port</label>
        <input
          type="number"
          value={params.port}
          onChange={(e) => setParams({ ...params, port: Number(e.target.value) })}
          style={{ width: 70 }}
        />
        <label>target</label>
        <input
          type="number"
          value={params.targetIndex}
          onChange={(e) => setParams({ ...params, targetIndex: Number(e.target.value) })}
          style={{ width: 50 }}
        />

        <label>navigate</label>
        <input
          placeholder="optional URL"
          value={params.navigateUrl ?? ''}
          onChange={(e) => setParams({ ...params, navigateUrl: e.target.value })}
          style={{ width: 220 }}
        />

        <div className="checks">
          {(['network', 'console', 'performance', 'perfMonitor', 'lifecycle'] as const).map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={(params as any)[k]}
                onChange={(e) => setParams({ ...params, [k]: e.target.checked } as any)}
              />
              {k}
            </label>
          ))}
        </div>

        {state.running ? (
          <button onClick={stop}>Stop</button>
        ) : (
          <button className="primary" onClick={start}>
            Start
          </button>
        )}
        <button onClick={snapshot}>Snapshot</button>
        <span className={`pill ${state.running ? 'live' : ''}`}>
          {state.running ? `LIVE · ${state.source}` : 'idle'}
        </span>
        <span className="dim">events: {state.eventCount}</span>
        {error && <span style={{ color: 'var(--err)' }}>{error}</span>}
      </header>

      <div className="layout">
        <div className="panel">
          <div className="tabs">
            <div className={`tab ${tab === 'network' ? 'active' : ''}`} onClick={() => setTab('network')}>
              Network ({counts.total} · ok {counts.ok} · fail {counts.fail})
            </div>
            <div className={`tab ${tab === 'console' ? 'active' : ''}`} onClick={() => setTab('console')}>
              Console / Log ({consoleEntries.length})
            </div>
          </div>
          <div className="list">
            {tab === 'network' ? (
              <NetworkTable rows={networkRows} />
            ) : (
              <ConsoleList entries={consoleEntries} />
            )}
          </div>
        </div>

        <div className="panel" style={{ borderRight: 'none' }}>
          <h2>Performance Monitor</h2>
          <div>
            {PERF_KEYS.map((k) => (
              <div className="spark" key={k}>
                <span>{k}</span>
                <Sparkline values={perfHistRef.current[k] ?? []} />
                <span style={{ textAlign: 'right' }}>
                  {fmtNum(perfLatest[k])}
                </span>
              </div>
            ))}
          </div>
          <h2>All metrics (latest)</h2>
          <div className="metrics">
            <table>
              <tbody>
                {Object.entries(perfLatest)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="k">{k}</td>
                      <td className="v">{fmtNum(v)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function NetworkTable({ rows }: { rows: NetRow[] }) {
  // newest at top
  const view = rows.slice().reverse().slice(0, 500);
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 50 }}>src</th>
          <th style={{ width: 60 }}>status</th>
          <th style={{ width: 60 }}>method</th>
          <th style={{ width: 80 }}>type</th>
          <th>url</th>
          <th style={{ width: 60 }}>ms</th>
          <th style={{ width: 70 }}>size</th>
        </tr>
      </thead>
      <tbody>
        {view.map((r) => (
          <tr key={r.requestId}>
            <td className="muted">{r.source}</td>
            <td className={r.failed ? 'status-5xx' : statusClass(r.status)}>
              {r.failed ? 'FAIL' : r.status ?? '…'}
            </td>
            <td>{r.method}</td>
            <td className="muted">{r.type ?? ''}</td>
            <td title={r.url}>{trim(r.url, 110)}</td>
            <td className="muted">
              {r.finishedAt ? `${r.finishedAt - r.startedAt}` : ''}
            </td>
            <td className="muted">{r.encodedDataLength ? fmtBytes(r.encodedDataLength) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConsoleList({
  entries,
}: {
  entries: Array<{ time: string; level: string; text: string; source: string }>;
}) {
  const view = entries.slice().reverse().slice(0, 500);
  return (
    <div>
      {view.map((e, i) => (
        <div key={i} className={`console-line ${e.level}`}>
          <span className="muted">{e.time.slice(11, 23)} </span>
          <span className="muted">[{e.source}]</span>{' '}
          <strong>{e.level.toUpperCase()}</strong>{' '}
          {e.text}
        </div>
      ))}
    </div>
  );
}

function appendCapped<T>(arr: T[], cap: number, item: T): T[] {
  const next = arr.length >= cap ? arr.slice(arr.length - cap + 1) : arr.slice();
  next.push(item);
  return next;
}

function statusClass(s?: number) {
  if (!s) return 'muted';
  if (s < 300) return 'status-2xx';
  if (s < 400) return 'status-3xx';
  if (s < 500) return 'status-4xx';
  return 'status-5xx';
}
function trim(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
function fmtNum(v: number | undefined) {
  if (v === undefined) return '';
  if (Math.abs(v) > 1e6) return v.toExponential(2);
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(3);
}
