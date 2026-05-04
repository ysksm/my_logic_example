import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const STROKE = '#58a6ff';
const FILL = 'rgba(88, 166, 255, 0.18)';

export type SparklineProps = {
  /** Unix timestamps in seconds, monotonically increasing. */
  times: number[];
  /** Same length as `times`. NaN gaps are allowed. */
  values: number[];
  /** Monotonically increasing on every new sample — drives setData even
   *  when the array refs are stable (parent mutates in place). */
  sampleSeq?: number;
  /** When true, draws an HH:MM:SS x-axis. Default false. */
  showXAxis?: boolean;
  /** Cursor-sync key — sparklines sharing the same key cross-hair together. */
  syncKey?: string;
  /** Tooltip value formatter. Defaults to `String(v)`. */
  format?: (v: number) => string;
};

// uPlot wrapper. Time-based x-axis, cross-chart cursor sync, and a tiny
// in-host tooltip that follows the hover. The tooltip shows
//   HH:MM:SS  ·  formatted value
export function Sparkline({
  times,
  values,
  sampleSeq = 0,
  showXAxis = false,
  syncKey,
  format,
}: SparklineProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const fmtRef = useRef(format ?? defaultFormat);
  fmtRef.current = format ?? defaultFormat;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const tip = document.createElement('div');
    tip.className = 'sparkline-tip';
    host.appendChild(tip);
    tipRef.current = tip;

    const opts: uPlot.Options = {
      width: host.clientWidth || 200,
      height: host.clientHeight || 36,
      pxAlign: 0,
      cursor: {
        show: true,
        drag: { x: false, y: false, setScale: false },
        points: { show: true, size: 4, fill: STROKE, stroke: STROKE },
        sync: syncKey ? { key: syncKey } : undefined,
      },
      legend: { show: false },
      scales: {
        x: { time: true },
        y: { auto: true },
      },
      axes: [
        {
          show: showXAxis,
          stroke: 'rgba(139, 148, 158, 0.6)',
          grid: { show: false },
          ticks: { show: false },
          space: 80,
          values: (_u, ticks) => ticks.map(formatHHMMSS),
        },
        { show: false },
      ],
      series: [
        {},
        {
          stroke: STROKE,
          width: 1.5,
          fill: FILL,
          points: { show: false },
          paths: uPlot.paths.linear?.(),
        },
      ],
      hooks: {
        setCursor: [
          (u) => {
            if (!tipRef.current) return;
            const idx = u.cursor.idx;
            if (
              idx == null ||
              !u.data?.[0] ||
              idx < 0 ||
              idx >= u.data[0].length
            ) {
              tipRef.current.style.display = 'none';
              return;
            }
            const t = u.data[0][idx] as number | null;
            const v = u.data[1][idx] as number | null;
            if (t == null || v == null || Number.isNaN(v)) {
              tipRef.current.style.display = 'none';
              return;
            }
            tipRef.current.textContent = `${formatHHMMSS(t)} · ${fmtRef.current(v)}`;
            tipRef.current.style.display = 'block';
            const left = Math.max(
              4,
              Math.min(host.clientWidth - 4, u.cursor.left ?? 0),
            );
            tipRef.current.style.left = `${left}px`;
          },
        ],
      },
    };
    const u = new uPlot(opts, [[], []], host);
    plotRef.current = u;

    const ro = new ResizeObserver(() => {
      u.setSize({
        width: host.clientWidth || 200,
        height: host.clientHeight || 36,
      });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      u.destroy();
      tip.remove();
      plotRef.current = null;
      tipRef.current = null;
    };
    // showXAxis / syncKey are baked into the uPlot instance; remount on change.
  }, [showXAxis, syncKey]);

  // Streaming setData. Coalesce rapid prop updates into one rAF tick so the
  // canvas redraws once per frame even if the parent fires multiple
  // re-renders per second. We depend on `sampleSeq` (a monotonic counter)
  // because the parent mutates the times/values arrays in place — the
  // refs are stable across renders so React can't see the mutation.
  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const u2 = plotRef.current;
      if (!u2) return;
      if (times.length < 2 || values.length < 2) {
        u2.setData([[], []]);
        return;
      }
      u2.setData([times, values]);
    };
    raf = requestAnimationFrame(apply);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleSeq]);

  return <div ref={hostRef} className="uplot-host" />;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function formatHHMMSS(secs: number) {
  const d = new Date(secs * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function defaultFormat(v: number) {
  if (Math.abs(v) >= 1e9) return v.toExponential(2);
  if (Math.abs(v) >= 1e6) return v.toFixed(0);
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(3);
}
