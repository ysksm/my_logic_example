import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const STROKE = '#58a6ff';
const FILL = 'rgba(88, 166, 255, 0.18)';

// Tiny axis-less, cursor-less uPlot wrapper used as a sparkline. uPlot's
// API is imperative, so we keep one instance per mount and feed it new
// data via setData on every props update.
export function Sparkline({ values }: { values: number[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const opts: uPlot.Options = {
      width: host.clientWidth || 200,
      height: host.clientHeight || 36,
      pxAlign: 0,
      cursor: { show: false, drag: { x: false, y: false, setScale: false } },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        { show: false },
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
    };
    const u = new uPlot(opts, [[], []], host);
    plotRef.current = u;

    const ro = new ResizeObserver(() => {
      if (!host) return;
      u.setSize({
        width: host.clientWidth || 200,
        height: host.clientHeight || 36,
      });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    if (values.length < 2) {
      u.setData([[], []]);
      return;
    }
    const xs = new Array(values.length);
    for (let i = 0; i < values.length; i++) xs[i] = i;
    u.setData([xs, values]);
  }, [values]);

  return <div ref={hostRef} className="uplot-host" />;
}
