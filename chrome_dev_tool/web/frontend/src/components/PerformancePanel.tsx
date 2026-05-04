import { useState } from 'react';
import { api, type NetworkPreset, type TraceFile } from '../api';
import { TraceViewer } from './TraceViewer';

const NETWORK_OPTIONS: { value: NetworkPreset; label: string }[] = [
  { value: 'online', label: 'Online — no throttling' },
  { value: 'fast-4g', label: 'Fast 4G' },
  { value: 'slow-4g', label: 'Slow 4G' },
  { value: 'fast-3g', label: 'Fast 3G' },
  { value: 'slow-3g', label: 'Slow 3G' },
  { value: 'offline', label: 'Offline' },
];

const CPU_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'No throttling' },
  { value: 2, label: '2× slowdown' },
  { value: 4, label: '4× slowdown' },
  { value: 6, label: '6× slowdown' },
  { value: 20, label: '20× slowdown' },
];

export function PerformancePanel() {
  const [network, setNetwork] = useState<NetworkPreset>('online');
  const [cpu, setCpu] = useState<number>(1);
  const [appliedNetwork, setAppliedNetwork] = useState<NetworkPreset | null>(null);
  const [appliedCpu, setAppliedCpu] = useState<number | null>(null);

  const [recording, setRecording] = useState(false);
  const [recStartedAt, setRecStartedAt] = useState<number | null>(null);
  const [lastTrace, setLastTrace] = useState<TraceFile | null>(null);
  const [lastTraceName, setLastTraceName] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function applyThrottling() {
    const ok = await call(() =>
      api.throttle({ networkPreset: network, cpuRate: cpu }),
    );
    if (ok) {
      setAppliedNetwork(network);
      setAppliedCpu(cpu);
    }
  }

  async function startRec() {
    const ok = await call(() => api.traceStart());
    if (ok) {
      setRecording(true);
      setRecStartedAt(Date.now());
    }
  }

  async function stopRec() {
    const trace = await call(() => api.traceStop());
    setRecording(false);
    setRecStartedAt(null);
    if (trace) {
      const name = traceFileName();
      setLastTrace(trace);
      setLastTraceName(name);
      downloadTrace(trace, name);
    }
  }

  function downloadTrace(t: TraceFile, name: string) {
    const blob = new Blob([JSON.stringify(t)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function traceFileName(): string {
    const d = new Date();
    const stamp =
      d.getFullYear().toString().padStart(4, '0') +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') +
      '-' +
      String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0') +
      String(d.getSeconds()).padStart(2, '0');
    return `cdt-trace-${stamp}.json`;
  }

  const elapsed = recStartedAt ? Math.floor((Date.now() - recStartedAt) / 1000) : null;

  return (
    <div className="tab-pane perf-lab">
      <div className="subbar">
        <span className="dim">
          throttling と trace は CDP コマンドを直接送るので、
          先に Launch & Inspect で attach しておく必要があります。
        </span>
      </div>
      <div className="lab-grid">
        <section className="lab-card">
          <h3>ネットワーク スロットリング</h3>
          <p className="dim">
            Network.emulateNetworkConditions に preset を流します。
            offline / slow-3g 等は Chrome DevTools と同じ値。
          </p>
          <label className="lab-row">
            <span>preset</span>
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as NetworkPreset)}
            >
              {NETWORK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="lab-row">
            <span>CPU</span>
            <select
              value={cpu}
              onChange={(e) => setCpu(Number(e.target.value))}
            >
              {CPU_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="lab-actions">
            <button className="btn-primary" disabled={busy} onClick={applyThrottling}>
              Apply
            </button>
            <span className="dim">
              applied: net=
              <strong>{appliedNetwork ?? '—'}</strong>, cpu=
              <strong>{appliedCpu !== null ? `${appliedCpu}×` : '—'}</strong>
            </span>
          </div>
        </section>

        <section className="lab-card">
          <h3>トレース記録</h3>
          <p className="dim">
            Tracing.start / Tracing.end で記録。停止時に自動で
            <code> cdt-trace-YYYYMMDD-hhmmss.json</code> として
            ダウンロードします (Chrome DevTools の "Load profile" で開けます)。
          </p>
          <div className="lab-actions">
            {recording ? (
              <button className="btn-danger" disabled={busy} onClick={stopRec}>
                Stop &amp; save
              </button>
            ) : (
              <button className="btn-primary" disabled={busy} onClick={startRec}>
                Start recording
              </button>
            )}
            {recording && elapsed !== null && (
              <span className="rec-pill">
                ● recording · {elapsed}s
              </span>
            )}
          </div>
          {lastTrace && lastTraceName && (
            <>
              <div className="lab-row">
                <span>最後のトレース</span>
                <span className="dim trace-meta">
                  <code>{lastTraceName}</code> ·{' '}
                  {lastTrace.traceEvents.length.toLocaleString()} events
                </span>
              </div>
              <div className="lab-actions">
                <button
                  className="btn-primary"
                  onClick={() => setViewerOpen(true)}
                  disabled={busy}
                >
                  ツール内で表示
                </button>
                <button
                  onClick={() => downloadTrace(lastTrace, lastTraceName)}
                  disabled={busy}
                >
                  再ダウンロード
                </button>
                <button onClick={() => setShowHelp((s) => !s)}>
                  Chrome DevTools で開く方法
                </button>
              </div>
              {showHelp && (
                <div className="trace-help-card">
                  <strong>Chrome DevTools の Performance パネルで開く:</strong>
                  <ol>
                    <li>任意の Chrome タブで <code>Cmd+Option+I</code> (mac) /
                      <code> Ctrl+Shift+I</code> で DevTools を開く</li>
                    <li>「Performance」パネルを選択</li>
                    <li>左上の <strong>"Load profile…"</strong> アイコン (↑ 形) を
                      クリック、または保存した <code>.json</code> をパネルに
                      ドラッグ&ドロップ</li>
                  </ol>
                  <span className="dim">
                    フォーマットは Chrome DevTools 互換の
                    <code> {'{'}traceEvents, metadata{'}'}</code> です。
                  </span>
                </div>
              )}
            </>
          )}
        </section>

        {error && <div className="err lab-error">{error}</div>}
      </div>
      {viewerOpen && lastTrace && (
        <TraceViewer trace={lastTrace} onClose={() => setViewerOpen(false)} />
      )}
    </div>
  );
}
