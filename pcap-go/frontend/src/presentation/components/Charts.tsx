import type { ProtocolStat, RateBucket, Peer } from "@domain/idl";
import { formatBytes } from "@domain/types";

const PALETTE = [
  "#5b8def",
  "#4cc38a",
  "#f0b740",
  "#ef5b6a",
  "#9c5bef",
  "#5beff0",
  "#efa55b",
  "#cccccc",
];

// ---------- Protocol bar chart ----------

export function ProtocolBars({ title, stats }: { title: string; stats: ProtocolStat[] }) {
  const total = stats.reduce((s, p) => s + p.count, 0) || 1;
  return (
    <div className="chart">
      <h4>{title}</h4>
      {stats.length === 0 && <p className="muted">no data yet</p>}
      <ul className="bars">
        {stats.map((s, i) => {
          const pct = (s.count / total) * 100;
          return (
            <li key={s.name}>
              <span className="bar-label">
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                {s.name}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${pct}%`,
                    background: PALETTE[i % PALETTE.length],
                  }}
                />
              </span>
              <span className="bar-num">
                {s.count} <span className="muted">({pct.toFixed(1)}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Top-peers horizontal bar ----------

export function TopPeersBars({ peers }: { peers: Peer[] }) {
  const max = peers.reduce((m, p) => Math.max(m, p.packets), 0) || 1;
  return (
    <div className="chart">
      <h4>Top peers</h4>
      {peers.length === 0 && <p className="muted">no data yet</p>}
      <ul className="bars">
        {peers.map((p, i) => {
          const pct = (p.packets / max) * 100;
          const label = p.vendor ? `${p.address} · ${p.vendor}` : p.address;
          return (
            <li key={p.kind + p.address}>
              <span className="bar-label" title={label}>
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                {label}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${pct}%`,
                    background: PALETTE[i % PALETTE.length],
                  }}
                />
              </span>
              <span className="bar-num">
                {p.packets} <span className="muted">{formatBytes(p.bytes)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Packet rate sparkline ----------

export function RateChart({ buckets }: { buckets: RateBucket[] }) {
  const w = 600;
  const h = 120;
  const pad = { l: 36, r: 12, t: 14, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const n = buckets.length || 1;
  const x = (i: number) => pad.l + (innerW * i) / Math.max(1, n - 1);
  const y = (v: number) => pad.t + innerH - (innerH * v) / max;

  const path = buckets
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(b.count).toFixed(1)}`)
    .join(" ");

  return (
    <div className="chart">
      <h4>Packet rate (last 60s)</h4>
      <svg viewBox={`0 0 ${w} ${h}`} className="rate-chart">
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + innerH} stroke="#2a2f42" />
        <line x1={pad.l} y1={pad.t + innerH} x2={w - pad.r} y2={pad.t + innerH} stroke="#2a2f42" />
        <text x={pad.l - 6} y={pad.t + 8} textAnchor="end" className="axis">
          {max}
        </text>
        <text x={pad.l - 6} y={pad.t + innerH} textAnchor="end" className="axis">
          0
        </text>
        <path d={path} fill="none" stroke="#5b8def" strokeWidth={1.5} />
        {buckets.length > 0 && (
          <path
            d={`${path} L${x(n - 1)},${pad.t + innerH} L${x(0)},${pad.t + innerH} Z`}
            fill="rgba(91,141,239,0.15)"
            stroke="none"
          />
        )}
        <text x={pad.l} y={h - 4} className="axis">
          -60s
        </text>
        <text x={w - pad.r} y={h - 4} textAnchor="end" className="axis">
          now
        </text>
      </svg>
    </div>
  );
}
