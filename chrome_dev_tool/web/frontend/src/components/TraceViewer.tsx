import { useEffect, useMemo, useRef, useState } from 'react';
import type { TraceFile } from '../api';
import {
  type Block,
  type Lane,
  type ParsedTrace,
  colorForName,
  fmtMicros,
  parseTrace,
} from './traceParser';

const ROW_HEIGHT = 16;
const LANE_HEADER = 22;
const LANE_GAP = 6;
const RULER = 24;
const LEFT_PAD = 0;

type View = { startUs: number; endUs: number };

export function TraceViewer({
  trace,
  onClose,
}: {
  trace: TraceFile;
  onClose: () => void;
}) {
  const parsed = useMemo<ParsedTrace>(
    () => parseTrace(trace.traceEvents ?? []),
    [trace],
  );

  const [view, setView] = useState<View>({
    startUs: parsed.minTs,
    endUs: parsed.maxTs,
  });
  const [hover, setHover] = useState<{
    block: Block;
    lane: Lane;
    x: number;
    y: number;
  } | null>(null);
  const [search, setSearch] = useState('');

  // Reset view when trace changes.
  useEffect(() => {
    setView({ startUs: parsed.minTs, endUs: parsed.maxTs });
  }, [parsed]);

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout: y-offset for each lane.
  const layout = useMemo(() => {
    const offsets: number[] = [];
    let y = RULER;
    for (const lane of parsed.lanes) {
      offsets.push(y);
      y += LANE_HEADER + lane.maxDepth * ROW_HEIGHT + LANE_GAP;
    }
    return { offsets, totalHeight: Math.max(y, 200) };
  }, [parsed]);

  // Resize observer + redraw on view change.
  useEffect(() => {
    const cvs = canvasRef.current;
    const cont = containerRef.current;
    if (!cvs || !cont) return;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const w = cont.clientWidth;
      const h = layout.totalHeight;
      cvs.width = w * dpr;
      cvs.height = h * dpr;
      cvs.style.width = `${w}px`;
      cvs.style.height = `${h}px`;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      // Clear
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, w, h);

      // Ruler
      drawRuler(ctx, w, view);

      const span = view.endUs - view.startUs || 1;
      const pxPerUs = w / span;
      const q = search.trim().toLowerCase();

      for (let i = 0; i < parsed.lanes.length; i++) {
        const lane = parsed.lanes[i];
        const ly = layout.offsets[i];
        // Lane header
        ctx.fillStyle = '#161b22';
        ctx.fillRect(0, ly, w, LANE_HEADER);
        ctx.fillStyle = '#8b949e';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `${lane.label} · ${lane.blocks.length} events`,
          8,
          ly + LANE_HEADER / 2,
        );

        const blockTop = ly + LANE_HEADER;
        for (const b of lane.blocks) {
          const x = (b.ts - view.startUs) * pxPerUs;
          const bw = b.dur * pxPerUs;
          if (x + bw < 0 || x > w) continue;
          const visW = Math.max(bw, 0.5);
          const by = blockTop + b.depth * ROW_HEIGHT;
          const matched = q === '' || b.name.toLowerCase().includes(q);
          ctx.fillStyle = matched ? colorForName(b.name) : 'rgba(60, 70, 84, 0.5)';
          ctx.fillRect(x, by, visW, ROW_HEIGHT - 1);
          if (visW > 30) {
            ctx.fillStyle = '#0d1117';
            ctx.font = '10px ui-monospace, monospace';
            const truncated =
              b.name.length > Math.max(2, Math.floor(visW / 6))
                ? b.name.slice(0, Math.max(2, Math.floor(visW / 6))) + '…'
                : b.name;
            ctx.fillText(truncated, x + 3, by + ROW_HEIGHT / 2);
          }
        }
      }

      // Hover marker
      if (hover) {
        const x = (hover.block.ts - view.startUs) * pxPerUs;
        const bw = Math.max(hover.block.dur * pxPerUs, 1);
        const by =
          layout.offsets[parsed.lanes.indexOf(hover.lane)] +
          LANE_HEADER +
          hover.block.depth * ROW_HEIGHT;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, by + 0.5, bw - 1, ROW_HEIGHT - 2);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cont);
    return () => ro.disconnect();
  }, [parsed, view, hover, layout, search]);

  function findBlockAt(
    cx: number,
    cy: number,
    width: number,
  ): { block: Block; lane: Lane } | null {
    if (cy < RULER) return null;
    const span = view.endUs - view.startUs || 1;
    const pxPerUs = width / span;
    const ts = view.startUs + cx / pxPerUs;
    for (let i = 0; i < parsed.lanes.length; i++) {
      const lane = parsed.lanes[i];
      const top = layout.offsets[i];
      const bottom = top + LANE_HEADER + lane.maxDepth * ROW_HEIGHT;
      if (cy < top || cy > bottom) continue;
      if (cy < top + LANE_HEADER) return null;
      const depth = Math.floor((cy - top - LANE_HEADER) / ROW_HEIGHT);
      // Find the block at this depth whose ts <= cursorTs <= ts+dur.
      for (let j = lane.blocks.length - 1; j >= 0; j--) {
        const b = lane.blocks[j];
        if (b.depth !== depth) continue;
        if (b.ts <= ts && ts <= b.ts + b.dur) return { block: b, lane };
      }
      return null;
    }
    return null;
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!e.shiftKey && Math.abs(e.deltaX) < 1) {
      e.preventDefault();
    }
    const cont = containerRef.current;
    if (!cont) return;
    const rect = cont.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const span = view.endUs - view.startUs || 1;

    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // Pan
      const dx = (e.deltaX || e.deltaY) * (span / rect.width);
      setView((v) => ({ startUs: v.startUs + dx, endUs: v.endUs + dx }));
      return;
    }
    // Zoom toward cursor
    const cursorTs = view.startUs + (cx / rect.width) * span;
    const factor = Math.pow(1.0015, e.deltaY);
    const nstart = cursorTs - (cursorTs - view.startUs) * factor;
    const nend = cursorTs + (view.endUs - cursorTs) * factor;
    if (nend - nstart < 100) return; // clamp at 100μs
    if (nend - nstart > (parsed.maxTs - parsed.minTs) * 4) return; // clamp out
    setView({ startUs: nstart, endUs: nend });
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const cont = containerRef.current;
    if (!cont) return;
    const startX = e.clientX;
    const startView = { ...view };
    const w = cont.clientWidth;
    cont.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dxPx = ev.clientX - startX;
      const span = startView.endUs - startView.startUs;
      const dxUs = -(dxPx / w) * span;
      setView({ startUs: startView.startUs + dxUs, endUs: startView.endUs + dxUs });
    };
    const up = () => {
      cont.removeEventListener('pointermove', move);
      cont.removeEventListener('pointerup', up);
      cont.removeEventListener('pointercancel', up);
    };
    cont.addEventListener('pointermove', move);
    cont.addEventListener('pointerup', up);
    cont.addEventListener('pointercancel', up);
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const cont = containerRef.current;
    if (!cont) return;
    const rect = cont.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const hit = findBlockAt(cx, cy, rect.width);
    if (hit) {
      setHover({ ...hit, x: e.clientX, y: e.clientY });
    } else if (hover) {
      setHover(null);
    }
  }

  function fitAll() {
    setView({ startUs: parsed.minTs, endUs: parsed.maxTs });
  }

  const totalSpanMs = (parsed.maxTs - parsed.minTs) / 1000;
  const viewSpanMs = (view.endUs - view.startUs) / 1000;

  return (
    <div className="trace-modal">
      <div className="trace-header">
        <h2>トレースビューア</h2>
        <span className="dim">
          {parsed.totalEvents} raw events · {parsed.totalBlocks} blocks ·
          {' '}
          {parsed.lanes.length} threads · 全体 {totalSpanMs.toFixed(1)} ms ·
          表示 {viewSpanMs.toFixed(1)} ms
        </span>
        <input
          placeholder="name contains…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
        <button onClick={fitAll}>Fit all</button>
        <span className="spacer" />
        <button className="btn-danger" onClick={onClose}>
          Close (Esc)
        </button>
      </div>
      <div className="trace-canvas-host" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: 'block' }}
        />
        {hover && (
          <div
            className="trace-tip"
            style={{
              left: hover.x + 12,
              top: hover.y + 12,
            }}
          >
            <div className="t-name">{hover.block.name}</div>
            <div className="t-meta">
              <span>cat:</span> {hover.block.cat || '—'}
            </div>
            <div className="t-meta">
              <span>dur:</span> {fmtMicros(hover.block.dur)}
            </div>
            <div className="t-meta">
              <span>start:</span> {fmtMicros(hover.block.ts - parsed.minTs)} from start
            </div>
            <div className="t-meta">
              <span>thread:</span> {hover.lane.label}
            </div>
            {hover.block.args && Object.keys(hover.block.args).length > 0 && (
              <pre className="t-args">{JSON.stringify(hover.block.args, null, 2)}</pre>
            )}
          </div>
        )}
      </div>
      <div className="trace-help">
        スクロールでズーム · shift + スクロール / ドラッグで横移動 · Esc で閉じる
      </div>
    </div>
  );
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: View,
) {
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, w, RULER);
  ctx.strokeStyle = '#30363d';
  ctx.beginPath();
  ctx.moveTo(0, RULER - 0.5);
  ctx.lineTo(w, RULER - 0.5);
  ctx.stroke();
  const span = view.endUs - view.startUs;
  if (span <= 0) return;
  // Pick a tick interval that gives roughly 6-12 ticks across the canvas.
  const desiredTicks = 8;
  const rawStep = span / desiredTicks;
  const niceStep = niceNumber(rawStep);
  const startTick = Math.ceil(view.startUs / niceStep) * niceStep;
  ctx.fillStyle = '#8b949e';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  for (let t = startTick; t <= view.endUs; t += niceStep) {
    const x = ((t - view.startUs) / span) * w;
    ctx.strokeStyle = 'rgba(48, 54, 61, 0.6)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, RULER);
    ctx.stroke();
    ctx.fillText(fmtMicros(t - view.startUs + (view.startUs - view.startUs)), x + 4, RULER / 2);
  }
  // suppress-unused
  void LEFT_PAD;
}

function niceNumber(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  let nice = 1;
  if (f < 1.5) nice = 1;
  else if (f < 3) nice = 2;
  else if (f < 7) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}
