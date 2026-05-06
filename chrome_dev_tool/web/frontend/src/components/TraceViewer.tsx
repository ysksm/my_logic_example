import { useEffect, useMemo, useRef, useState } from 'react';
import type { TraceFile } from '../api';
import {
  type Block,
  type Lane,
  type ParsedTrace,
  aggregateRange,
  colorForName,
  fmtMicros,
  parseTrace,
} from './traceParser';

const ROW_HEIGHT = 16;
const LANE_HEADER = 22;
const LANE_GAP = 6;
const RULER = 24;
const MARKER_LANE = 18;
const FRAME_LANE = 14;
const SHOT_LANE = 44;
const LEFT_PAD = 0;

type View = { startUs: number; endUs: number };
type Selection = { startUs: number; endUs: number };

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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);

  // All blocks transitively reachable from the selected block via shared
  // flow ids, plus the flow groups themselves (for arrow drawing).
  const connections = useMemo(() => {
    if (selectedBlockId == null) return null;
    const flowIds = parsed.blockFlows.get(selectedBlockId);
    if (!flowIds || flowIds.length === 0) return null;
    const flowSet = new Set(flowIds);
    const groups = parsed.flows.filter((f) => flowSet.has(f.id));
    const blockSet = new Set<number>();
    for (const g of groups) for (const p of g.points) blockSet.add(p.blockId);
    blockSet.delete(selectedBlockId);
    return { groups, related: blockSet };
  }, [selectedBlockId, parsed]);

  // Reset view when trace changes.
  useEffect(() => {
    setView({ startUs: parsed.minTs, endUs: parsed.maxTs });
  }, [parsed]);

  // Escape to close (or, if a block is selected, deselect first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedBlockId != null) {
        setSelectedBlockId(null);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selectedBlockId]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout: y-offset for each lane.
  const layout = useMemo(() => {
    const offsets: number[] = [];
    let y = RULER;
    const markerY = parsed.markers.length > 0 ? y : -1;
    if (parsed.markers.length > 0) y += MARKER_LANE;
    const frameY = parsed.frames.length > 0 ? y : -1;
    if (parsed.frames.length > 0) y += FRAME_LANE + 2;
    const shotY = parsed.screenshots.length > 0 ? y : -1;
    if (parsed.screenshots.length > 0) y += SHOT_LANE + 2;
    for (const lane of parsed.lanes) {
      offsets.push(y);
      y += LANE_HEADER + lane.maxDepth * ROW_HEIGHT + LANE_GAP;
    }
    return { offsets, markerY, frameY, shotY, totalHeight: Math.max(y, 200) };
  }, [parsed]);

  // Preload screenshot images so canvas drawImage has them ready.
  const shotImagesRef = useRef<HTMLImageElement[]>([]);
  const [shotsReady, setShotsReady] = useState(0);
  useEffect(() => {
    shotImagesRef.current = [];
    setShotsReady(0);
    if (parsed.screenshots.length === 0) return;
    let cancelled = false;
    let loaded = 0;
    const imgs: HTMLImageElement[] = parsed.screenshots.map((s) => {
      const img = new Image();
      img.src = s.dataUrl;
      img.onload = () => {
        if (cancelled) return;
        loaded++;
        // Coalesce: bump after every batch so we don't redraw per image.
        if (loaded === parsed.screenshots.length || loaded % 8 === 0) {
          setShotsReady(loaded);
        }
      };
      img.onerror = () => {
        if (cancelled) return;
        loaded++;
        if (loaded === parsed.screenshots.length) setShotsReady(loaded);
      };
      return img;
    });
    shotImagesRef.current = imgs;
    return () => {
      cancelled = true;
    };
  }, [parsed.screenshots]);

  const [shotHover, setShotHover] = useState<{
    idx: number;
    x: number;
    y: number;
  } | null>(null);

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

      // Frames lane: one rect per frame, colored by duration.
      if (layout.frameY >= 0 && parsed.frames.length > 0) {
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, layout.frameY, w, FRAME_LANE);
        for (const f of parsed.frames) {
          const x = (f.ts - view.startUs) * pxPerUs;
          const fw = f.dur * pxPerUs;
          if (x + fw < 0 || x > w) continue;
          // Green ≤16.67ms (60fps), yellow ≤33.33ms (30fps), red beyond.
          let color = '#3fb950'; // green
          if (f.dur > 33_333) color = '#f85149';
          else if (f.dur > 16_667) color = '#d29922';
          ctx.fillStyle = color;
          ctx.fillRect(
            Math.max(x, 0),
            layout.frameY + 2,
            Math.max(Math.min(fw, w - x), 1),
            FRAME_LANE - 4,
          );
        }
        // Lane label on the left edge.
        ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
        ctx.fillRect(0, layout.frameY, 56, FRAME_LANE);
        ctx.fillStyle = '#8b949e';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'start';
        ctx.fillText('frames', 6, layout.frameY + FRAME_LANE / 2);
      }

      // Screenshots lane: thumbnails decimated so they don't overlap.
      if (
        layout.shotY >= 0 &&
        parsed.screenshots.length > 0 &&
        shotImagesRef.current.length > 0
      ) {
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, layout.shotY, w, SHOT_LANE);
        const thumbH = SHOT_LANE - 4;
        let lastRight = -Infinity;
        for (let i = 0; i < parsed.screenshots.length; i++) {
          const s = parsed.screenshots[i];
          const x = (s.ts - view.startUs) * pxPerUs;
          if (x < -120 || x > w + 120) continue;
          const img = shotImagesRef.current[i];
          if (!img || !img.naturalWidth) continue;
          const aspect = img.naturalWidth / img.naturalHeight;
          const thumbW = Math.max(20, Math.round(thumbH * aspect));
          if (x < lastRight + 2) continue; // decimate
          ctx.drawImage(img, x, layout.shotY + 2, thumbW, thumbH);
          ctx.strokeStyle = 'rgba(48,54,61,0.8)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, layout.shotY + 2.5, thumbW - 1, thumbH - 1);
          lastRight = x + thumbW;
        }
        // Lane label.
        ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
        ctx.fillRect(0, layout.shotY, 56, 14);
        ctx.fillStyle = '#8b949e';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'start';
        ctx.fillText('shots', 6, layout.shotY + 8);
      }

      // Markers: vertical guide line through the whole chart + label in the
      // dedicated lane just below the ruler.
      if (layout.markerY >= 0 && parsed.markers.length > 0) {
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, layout.markerY, w, MARKER_LANE);
        for (const m of parsed.markers) {
          const x = (m.ts - view.startUs) * pxPerUs;
          if (x < -40 || x > w + 40) continue;
          ctx.strokeStyle = m.color;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, layout.markerY);
          ctx.lineTo(x + 0.5, h);
          ctx.stroke();
          ctx.globalAlpha = 1;
          // Label badge.
          ctx.fillStyle = m.color;
          const label = m.label;
          ctx.font = 'bold 10px ui-monospace, monospace';
          const tw = ctx.measureText(label).width + 8;
          ctx.fillRect(x - tw / 2, layout.markerY + 2, tw, MARKER_LANE - 4);
          ctx.fillStyle = '#0d1117';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';
          ctx.fillText(label, x, layout.markerY + MARKER_LANE / 2);
          ctx.textAlign = 'start';
        }
      }

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
          // Long task: ≥50ms top-level work on a main thread is visualized
          // with a red striped overlay + outline (Chrome DevTools convention).
          if (lane.isMain && b.depth === 0 && b.dur >= 50_000) {
            ctx.fillStyle = 'rgba(248, 81, 73, 0.35)';
            ctx.fillRect(x, by, visW, ROW_HEIGHT - 1);
            ctx.strokeStyle = '#f85149';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, by + 0.5, Math.max(visW - 1, 0), ROW_HEIGHT - 2);
          }
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

      // Connection highlights + arrows for the currently selected block.
      if (selectedBlockId != null) {
        const selRef = parsed.blockById.get(selectedBlockId);
        if (selRef) {
          const laneIdx = parsed.lanes.indexOf(selRef.lane);
          if (laneIdx >= 0) {
            const sb = selRef.block;
            const sLy = layout.offsets[laneIdx];
            const sx = (sb.ts - view.startUs) * pxPerUs;
            const sw = Math.max(sb.dur * pxPerUs, 1);
            const sy = sLy + LANE_HEADER + sb.depth * ROW_HEIGHT;
            // Selected block: bright outline.
            ctx.strokeStyle = '#58a6ff';
            ctx.lineWidth = 2;
            ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, ROW_HEIGHT - 2);

            if (connections) {
              // Outline related blocks.
              ctx.strokeStyle = '#a371f7';
              ctx.lineWidth = 1.5;
              for (const rid of connections.related) {
                const r = parsed.blockById.get(rid);
                if (!r) continue;
                const rLaneIdx = parsed.lanes.indexOf(r.lane);
                if (rLaneIdx < 0) continue;
                const rx = (r.block.ts - view.startUs) * pxPerUs;
                const rw = Math.max(r.block.dur * pxPerUs, 1);
                if (rx + rw < 0 || rx > w) continue;
                const ry =
                  layout.offsets[rLaneIdx] +
                  LANE_HEADER +
                  r.block.depth * ROW_HEIGHT;
                ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, ROW_HEIGHT - 2);
              }
              // Curves from the selected block to each related block.
              for (const g of connections.groups) {
                ctx.strokeStyle = g.color;
                ctx.globalAlpha = 0.85;
                ctx.lineWidth = 1.25;
                for (const p of g.points) {
                  if (p.blockId === selectedBlockId) continue;
                  const r = parsed.blockById.get(p.blockId);
                  if (!r) continue;
                  const rLaneIdx = parsed.lanes.indexOf(r.lane);
                  if (rLaneIdx < 0) continue;
                  const rx = (r.block.ts - view.startUs) * pxPerUs;
                  const rw = Math.max(r.block.dur * pxPerUs, 1);
                  const ry =
                    layout.offsets[rLaneIdx] +
                    LANE_HEADER +
                    r.block.depth * ROW_HEIGHT;
                  // Direction matches ts ordering.
                  const fwd = sb.ts <= r.block.ts;
                  const ax = fwd ? sx + sw : sx;
                  const ay = sy + ROW_HEIGHT / 2;
                  const bx = fwd ? rx : rx + rw;
                  const by = ry + ROW_HEIGHT / 2;
                  const mx = (ax + bx) / 2;
                  ctx.beginPath();
                  ctx.moveTo(ax, ay);
                  ctx.bezierCurveTo(mx, ay, mx, by, bx, by);
                  ctx.stroke();
                  // Arrowhead at b.
                  const dir = fwd ? -1 : 1;
                  ctx.beginPath();
                  ctx.moveTo(bx, by);
                  ctx.lineTo(bx + 6 * dir, by - 3);
                  ctx.lineTo(bx + 6 * dir, by + 3);
                  ctx.closePath();
                  ctx.fillStyle = g.color;
                  ctx.fill();
                }
              }
              ctx.globalAlpha = 1;
            }
          }
        }
      }

      // Selection overlay
      if (selection) {
        const sx = (selection.startUs - view.startUs) * pxPerUs;
        const ex = (selection.endUs - view.startUs) * pxPerUs;
        const x0 = Math.max(0, Math.min(sx, ex));
        const x1 = Math.min(w, Math.max(sx, ex));
        if (x1 > x0) {
          ctx.fillStyle = 'rgba(88, 166, 255, 0.18)';
          ctx.fillRect(x0, 0, x1 - x0, h);
          ctx.strokeStyle = 'rgba(88, 166, 255, 0.85)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0 + 0.5, 0);
          ctx.lineTo(x0 + 0.5, h);
          ctx.moveTo(x1 - 0.5, 0);
          ctx.lineTo(x1 - 0.5, h);
          ctx.stroke();
        }
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cont);
    return () => ro.disconnect();
  }, [
    parsed,
    view,
    hover,
    layout,
    search,
    selection,
    shotsReady,
    selectedBlockId,
    connections,
  ]);

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
    const rect = cont.getBoundingClientRect();
    const w = cont.clientWidth;
    cont.setPointerCapture(e.pointerId);

    if (e.altKey) {
      // Alt+drag → range selection.
      const span = view.endUs - view.startUs;
      const startTs = view.startUs + ((e.clientX - rect.left) / w) * span;
      setSelection({ startUs: startTs, endUs: startTs });
      const move = (ev: PointerEvent) => {
        const ts = view.startUs + ((ev.clientX - rect.left) / w) * span;
        setSelection({
          startUs: Math.min(startTs, ts),
          endUs: Math.max(startTs, ts),
        });
      };
      const up = (ev: PointerEvent) => {
        const ts = view.startUs + ((ev.clientX - rect.left) / w) * span;
        const a = Math.min(startTs, ts);
        const b = Math.max(startTs, ts);
        if (b - a < (view.endUs - view.startUs) * 0.001) {
          // Treated as a click — clear instead of micro-selection.
          setSelection(null);
        } else {
          setSelection({ startUs: a, endUs: b });
        }
        cont.removeEventListener('pointermove', move);
        cont.removeEventListener('pointerup', up);
        cont.removeEventListener('pointercancel', up);
      };
      cont.addEventListener('pointermove', move);
      cont.addEventListener('pointerup', up);
      cont.addEventListener('pointercancel', up);
      return;
    }

    // Default: pan, plus click-detection for block selection on a pure click.
    const startX = e.clientX;
    const startY = e.clientY;
    const startView = { ...view };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dxPx = ev.clientX - startX;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) {
        moved = true;
      }
      const span = startView.endUs - startView.startUs;
      const dxUs = -(dxPx / w) * span;
      setView({ startUs: startView.startUs + dxUs, endUs: startView.endUs + dxUs });
    };
    const up = (ev: PointerEvent) => {
      cont.removeEventListener('pointermove', move);
      cont.removeEventListener('pointerup', up);
      cont.removeEventListener('pointercancel', up);
      if (!moved) {
        const cx = ev.clientX - rect.left;
        const cy = ev.clientY - rect.top;
        const hit = findBlockAt(cx, cy, w);
        setSelectedBlockId(hit ? hit.block.id : null);
      }
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

    // Screenshot lane hover takes precedence over block hover.
    if (
      layout.shotY >= 0 &&
      cy >= layout.shotY &&
      cy < layout.shotY + SHOT_LANE &&
      parsed.screenshots.length > 0
    ) {
      const span = view.endUs - view.startUs || 1;
      const ts = view.startUs + (cx / rect.width) * span;
      // Binary search for the screenshot whose ts is closest to (and ≤) ts.
      let lo = 0;
      let hi = parsed.screenshots.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (parsed.screenshots[mid].ts <= ts) lo = mid;
        else hi = mid - 1;
      }
      // Pick whichever of lo / lo+1 is closer.
      let idx = lo;
      const next = parsed.screenshots[lo + 1];
      if (
        next &&
        Math.abs(next.ts - ts) < Math.abs(parsed.screenshots[lo].ts - ts)
      ) {
        idx = lo + 1;
      }
      setShotHover({ idx, x: e.clientX, y: e.clientY });
      if (hover) setHover(null);
      return;
    }
    if (shotHover) setShotHover(null);

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

  function zoomToSelection() {
    if (!selection) return;
    const pad = (selection.endUs - selection.startUs) * 0.05;
    setView({
      startUs: selection.startUs - pad,
      endUs: selection.endUs + pad,
    });
  }

  const aggregation = useMemo(() => {
    if (!selection) return null;
    return aggregateRange(parsed, selection.startUs, selection.endUs);
  }, [parsed, selection]);

  const totalSpanMs = (parsed.maxTs - parsed.minTs) / 1000;
  const viewSpanMs = (view.endUs - view.startUs) / 1000;
  const selSpanMs = selection
    ? (selection.endUs - selection.startUs) / 1000
    : null;

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
        {selection && (
          <>
            <span className="dim sel-pill">
              選択: {fmtMicros(selection.endUs - selection.startUs)}
            </span>
            <button onClick={zoomToSelection}>Zoom to selection</button>
            <button onClick={() => setSelection(null)}>Clear selection</button>
          </>
        )}
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
          onMouseLeave={() => {
            setHover(null);
            setShotHover(null);
          }}
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
        {selectedBlockId != null &&
          parsed.blockById.get(selectedBlockId) && (
            <ConnectionsPanel
              parsed={parsed}
              selectedBlockId={selectedBlockId}
              connections={connections}
              onPick={(blockId) => {
                setSelectedBlockId(blockId);
                const r = parsed.blockById.get(blockId);
                if (!r) return;
                const b = r.block;
                const span = view.endUs - view.startUs;
                // Re-center the view on the chosen block while keeping zoom.
                const center = b.ts + b.dur / 2;
                setView({
                  startUs: center - span / 2,
                  endUs: center + span / 2,
                });
              }}
              onClose={() => setSelectedBlockId(null)}
            />
          )}
        {shotHover && parsed.screenshots[shotHover.idx] && (
          <div
            className="shot-preview"
            style={{ left: shotHover.x + 12, top: shotHover.y + 12 }}
          >
            <img
              src={parsed.screenshots[shotHover.idx].dataUrl}
              alt=""
              draggable={false}
            />
            <div className="shot-meta">
              {fmtMicros(parsed.screenshots[shotHover.idx].ts - parsed.minTs)}
              {' '}from start
            </div>
          </div>
        )}
      </div>
      {selection && aggregation && (
        <BottomUpPanel
          aggregation={aggregation}
          spanUs={selection.endUs - selection.startUs}
        />
      )}
      <div className="trace-help">
        スクロールでズーム · shift + スクロール / ドラッグで横移動 · Alt + ドラッグで範囲選択 · Esc で閉じる
      </div>
    </div>
  );
}

function ConnectionsPanel({
  parsed,
  selectedBlockId,
  connections,
  onPick,
  onClose,
}: {
  parsed: ParsedTrace;
  selectedBlockId: number;
  connections: { groups: ParsedTrace['flows']; related: Set<number> } | null;
  onPick: (blockId: number) => void;
  onClose: () => void;
}) {
  const sel = parsed.blockById.get(selectedBlockId);
  if (!sel) return null;
  const sb = sel.block;

  // Split related blocks into "before" / "after" by ts to surface the
  // direction of the link (closest to "Initiated by" / "Initiates" in DevTools).
  const before: { id: number; ts: number }[] = [];
  const after: { id: number; ts: number }[] = [];
  if (connections) {
    for (const id of connections.related) {
      const r = parsed.blockById.get(id);
      if (!r) continue;
      (r.block.ts < sb.ts ? before : after).push({
        id,
        ts: r.block.ts,
      });
    }
    before.sort((a, b) => b.ts - a.ts); // most recent first
    after.sort((a, b) => a.ts - b.ts);
  }

  function renderRow(id: number) {
    const r = parsed.blockById.get(id);
    if (!r) return null;
    return (
      <li key={id} onClick={() => onPick(id)}>
        <span
          className="swatch"
          style={{ background: colorForName(r.block.name) }}
        />
        <span className="name">{r.block.name}</span>
        <span className="dim lane-name">{r.lane.label}</span>
        <span className="dim ts">
          {fmtMicros(r.block.ts - parsed.minTs)}
        </span>
      </li>
    );
  }

  return (
    <div className="conn-panel">
      <div className="conn-header">
        <strong>つながり</strong>
        <span className="dim">
          flow: {connections ? connections.groups.length : 0} ·{' '}
          related: {connections ? connections.related.size : 0}
        </span>
        <button className="conn-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="conn-selected">
        <div className="dim">selected</div>
        <div className="conn-name">
          <span
            className="swatch"
            style={{ background: colorForName(sb.name) }}
          />
          {sb.name}
        </div>
        <div className="dim conn-meta">
          {sel.lane.label} · {fmtMicros(sb.dur)} ·{' '}
          {fmtMicros(sb.ts - parsed.minTs)} from start
        </div>
      </div>
      {(!connections || connections.related.size === 0) && (
        <div className="dim conn-empty">
          このブロックには紐づく flow event がありません。
        </div>
      )}
      {before.length > 0 && (
        <>
          <div className="conn-section-title">Initiated by ({before.length})</div>
          <ul className="conn-list">{before.map((b) => renderRow(b.id))}</ul>
        </>
      )}
      {after.length > 0 && (
        <>
          <div className="conn-section-title">Initiates ({after.length})</div>
          <ul className="conn-list">{after.map((a) => renderRow(a.id))}</ul>
        </>
      )}
    </div>
  );
}

function BottomUpPanel({
  aggregation,
  spanUs,
}: {
  aggregation: ReturnType<typeof aggregateRange>;
  spanUs: number;
}) {
  const [sortKey, setSortKey] = useState<'self' | 'total' | 'count' | 'name'>(
    'self',
  );
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let r = aggregation.rows;
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q));
    const sorted = [...r];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'total':
          return b.totalUs - a.totalUs;
        case 'count':
          return b.count - a.count;
        case 'self':
        default:
          return b.selfUs - a.selfUs;
      }
    });
    return sorted.slice(0, 200);
  }, [aggregation, sortKey, filter]);

  return (
    <div className="bottom-up">
      <div className="bottom-up-bar">
        <strong>Bottom-Up</strong>
        <span className="dim">
          選択範囲 {fmtMicros(spanUs)} · {aggregation.blockCount} blocks ·
          {' '}{aggregation.rows.length} unique names
        </span>
        <input
          placeholder="filter name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="bottom-up-scroll">
        <table className="bottom-up-table">
          <thead>
            <tr>
              <th
                className={sortKey === 'self' ? 'sort-active' : ''}
                onClick={() => setSortKey('self')}
              >
                Self
              </th>
              <th
                className={sortKey === 'total' ? 'sort-active' : ''}
                onClick={() => setSortKey('total')}
              >
                Total
              </th>
              <th
                className={sortKey === 'count' ? 'sort-active' : ''}
                onClick={() => setSortKey('count')}
              >
                Count
              </th>
              <th
                className={sortKey === 'name' ? 'sort-active' : ''}
                onClick={() => setSortKey('name')}
              >
                Name
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = spanUs > 0 ? (r.selfUs / spanUs) * 100 : 0;
              return (
                <tr key={r.name}>
                  <td className="num">
                    <span className="bar" style={{ width: `${Math.min(100, pct)}%` }} />
                    <span className="num-text">{fmtMicros(r.selfUs)}</span>
                    <span className="dim pct">{pct.toFixed(1)}%</span>
                  </td>
                  <td className="num">{fmtMicros(r.totalUs)}</td>
                  <td className="num">{r.count}</td>
                  <td className="name">
                    <span
                      className="swatch"
                      style={{ background: colorForName(r.name) }}
                    />
                    {r.name}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="dim center">
                  対象なし
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
