import { Sparkline } from './Sparkline';

type Vital = {
  key: string;
  label: string;
  fmt: (v: number) => string;
  derived?: boolean;
  hint?: string;
};

// Eight vitals that mirror Chrome DevTools' Performance Monitor.
// `derived` keys are calculated client-side from cumulative counters.
const VITALS: Vital[] = [
  {
    key: 'CpuUsage',
    label: 'CPU usage',
    fmt: (v) => `${v.toFixed(1)} %`,
    derived: true,
    hint: 'ΔTaskDuration / Δt × 100',
  },
  {
    key: 'JSHeapUsedSize',
    label: 'JS heap size',
    fmt: (v) => fmtBytes(v),
  },
  {
    key: 'Nodes',
    label: 'DOM Nodes',
    fmt: (v) => v.toFixed(0),
  },
  {
    key: 'JSEventListeners',
    label: 'JS event listeners',
    fmt: (v) => v.toFixed(0),
  },
  {
    key: 'Documents',
    label: 'Documents',
    fmt: (v) => v.toFixed(0),
  },
  {
    key: 'Frames',
    label: 'Document Frames',
    fmt: (v) => v.toFixed(0),
  },
  {
    key: 'LayoutsPerSec',
    label: 'Layouts / sec',
    fmt: (v) => v.toFixed(1),
    derived: true,
    hint: 'ΔLayoutCount / Δt',
  },
  {
    key: 'RecalcStylesPerSec',
    label: 'Style recalcs / sec',
    fmt: (v) => v.toFixed(1),
    derived: true,
    hint: 'ΔRecalcStyleCount / Δt',
  },
];

export function PerformanceMonitorPanel({
  times,
  history,
  latest,
  sampleSeq,
  onSnapshot,
}: {
  times: number[];
  history: Record<string, number[]>;
  latest: Record<string, number>;
  sampleSeq: number;
  onSnapshot: () => void;
}) {
  const allKeys = Object.keys(latest).sort((a, b) => a.localeCompare(b));
  const sampleCount = times.length;

  return (
    <div className="tab-pane">
      <div className="subbar">
        <button className="btn-primary" onClick={onSnapshot}>
          Snapshot
        </button>
        <span className="dim">
          {sampleCount === 0
            ? 'no samples yet — start the collector with `performance` enabled'
            : `${sampleCount} samples · ${allKeys.length} raw metrics + ${
                VITALS.filter((v) => v.derived).length
              } derived`}
        </span>
      </div>
      <div className="perf-layout">
        <div className="perf-vitals">
          <h3>パフォーマンスモニター</h3>
          {VITALS.map((v, i) => {
            const value = latest[v.key];
            const series = history[v.key] ?? [];
            const last = i === VITALS.length - 1;
            return (
              <div className="vital" key={v.key}>
                <div className="vital-head">
                  <span className="vital-label">
                    {v.label}
                    {v.derived && (
                      <span className="vital-derived" title={v.hint}>
                        derived
                      </span>
                    )}
                  </span>
                  <span className="vital-value">
                    {value === undefined ? '—' : v.fmt(value)}
                  </span>
                </div>
                <Sparkline
                  times={times}
                  values={series}
                  sampleSeq={sampleSeq}
                  showXAxis={last}
                  syncKey="perfMonitor"
                  format={v.fmt}
                />
              </div>
            );
          })}
        </div>
        <div className="perf-table">
          <h3>All metrics (raw, latest)</h3>
          <div className="metrics">
            <table>
              <tbody>
                {allKeys.map((k) => (
                  <tr key={k} className={isDerived(k) ? 'derived-row' : ''}>
                    <td className="k">
                      {k}
                      {isDerived(k) && <span className="vital-derived">derived</span>}
                    </td>
                    <td className="v">{fmtNum(latest[k])}</td>
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

const DERIVED_KEYS = new Set(['CpuUsage', 'LayoutsPerSec', 'RecalcStylesPerSec']);
function isDerived(k: string): boolean {
  return DERIVED_KEYS.has(k);
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtNum(v: number | undefined) {
  if (v === undefined) return '';
  if (Math.abs(v) >= 1e9) return v.toExponential(2);
  if (Math.abs(v) >= 1e6) return v.toFixed(0);
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(3);
}
