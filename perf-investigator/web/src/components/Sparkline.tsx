import { useEffect, useRef } from 'react';

// Tiny canvas sparkline. No deps — keeps the bundle small.
export function Sparkline({ values }: { values: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (c.width = c.clientWidth * dpr);
    const h = (c.height = c.clientHeight * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (values.length < 2) return;
    let min = Infinity,
      max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max === min) {
      max = min + 1;
    }
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((values[i] - min) / (max - min)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.25 * dpr;
    ctx.stroke();
  }, [values]);
  return <canvas ref={ref} />;
}
