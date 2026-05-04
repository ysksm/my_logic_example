import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { Layer, LayerPainted } from '../types';

export function LayersPanel({
  layers,
  paintFlash,
}: {
  layers: Layer[];
  paintFlash: LayerPainted | null;
}) {
  const [observing, setObserving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string[]>>({});
  const [reasonsBusy, setReasonsBusy] = useState(false);

  // Auto-pick first layer when the tree first arrives.
  useEffect(() => {
    if (!selectedId && layers.length > 0) setSelectedId(layers[0].layerId);
  }, [layers, selectedId]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api.layersStart();
      setObserving(true);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api.layersStop();
      setObserving(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function loadReasons(id: string) {
    if (reasons[id]) return;
    setReasonsBusy(true);
    try {
      const r = await api.layersReasons(id);
      setReasons((m) => ({ ...m, [id]: r.reasons }));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setReasonsBusy(false);
    }
  }

  useEffect(() => {
    if (selectedId) loadReasons(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selected = useMemo(
    () => layers.find((l) => l.layerId === selectedId) ?? null,
    [layers, selectedId],
  );

  const totals = useMemo(() => {
    let drawing = 0;
    let invisible = 0;
    let area = 0;
    let paints = 0;
    for (const l of layers) {
      if (l.drawsContent) drawing++;
      if (l.invisible) invisible++;
      area += l.width * l.height;
      paints += l.paintCount ?? 0;
    }
    return { drawing, invisible, area, paints };
  }, [layers]);

  return (
    <div className="tab-pane layers">
      <div className="subbar">
        {observing ? (
          <button className="btn-danger" onClick={stop} disabled={busy}>
            Stop layers
          </button>
        ) : (
          <button className="btn-primary" onClick={start} disabled={busy}>
            Start layers
          </button>
        )}
        <span className="dim">
          {layers.length === 0
            ? observing
              ? 'waiting for first layer tree …'
              : 'press Start to subscribe to LayerTree.layerTreeDidChange'
            : `${layers.length} layers · ${totals.drawing} drawing · ${totals.invisible} invisible · paints ${totals.paints}`}
        </span>
        {error && <span className="err">{error}</span>}
      </div>
      <div className="layers-layout">
        <div className="list">
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>id</th>
                <th style={{ width: 70 }}>parent</th>
                <th style={{ width: 110 }}>position</th>
                <th style={{ width: 110 }}>size</th>
                <th style={{ width: 60 }}>paints</th>
                <th style={{ width: 70 }}>flags</th>
                <th>composit. reasons (top 2)</th>
              </tr>
            </thead>
            <tbody>
              {layers.map((l) => {
                const rs = reasons[l.layerId] ?? [];
                const flashing =
                  paintFlash?.layerId === l.layerId ? 'flashing' : '';
                return (
                  <tr
                    key={l.layerId}
                    className={`${selectedId === l.layerId ? 'sel' : ''} ${flashing}`}
                    onClick={() => setSelectedId(l.layerId)}
                  >
                    <td className="muted">{l.layerId}</td>
                    <td className="muted">{l.parentLayerId ?? '—'}</td>
                    <td>
                      {l.offsetX.toFixed(0)}, {l.offsetY.toFixed(0)}
                    </td>
                    <td>
                      {l.width.toFixed(0)} × {l.height.toFixed(0)}
                    </td>
                    <td className="muted">{l.paintCount ?? 0}</td>
                    <td className="muted">
                      {l.drawsContent && <span title="drawsContent">D</span>}
                      {l.invisible && <span title="invisible"> I</span>}
                      {(l.scrollRectCount ?? 0) > 0 && (
                        <span title="has scroll rects"> S</span>
                      )}
                    </td>
                    <td className="muted">
                      {rs.slice(0, 2).join(', ')}
                      {rs.length > 2 ? `, +${rs.length - 2}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selected && (
          <div className="layers-detail">
            <h3>Layer {selected.layerId}</h3>
            <div className="kv">
              <span className="k">parent</span>
              <span className="v">{selected.parentLayerId ?? '—'}</span>
            </div>
            <div className="kv">
              <span className="k">backendNode</span>
              <span className="v">{selected.backendNodeId ?? '—'}</span>
            </div>
            <div className="kv">
              <span className="k">offset</span>
              <span className="v">
                {selected.offsetX.toFixed(1)}, {selected.offsetY.toFixed(1)}
              </span>
            </div>
            <div className="kv">
              <span className="k">size</span>
              <span className="v">
                {selected.width.toFixed(1)} × {selected.height.toFixed(1)} (
                {(selected.width * selected.height).toFixed(0)} px²)
              </span>
            </div>
            <div className="kv">
              <span className="k">paintCount</span>
              <span className="v">{selected.paintCount ?? 0}</span>
            </div>
            <div className="kv">
              <span className="k">drawsContent</span>
              <span className="v">{String(selected.drawsContent)}</span>
            </div>
            <div className="kv">
              <span className="k">invisible</span>
              <span className="v">{String(!!selected.invisible)}</span>
            </div>
            <div className="kv">
              <span className="k">scrollRects</span>
              <span className="v">{selected.scrollRectCount ?? 0}</span>
            </div>
            <h4>Compositing reasons</h4>
            {reasonsBusy && <div className="dim">loading…</div>}
            {!reasonsBusy &&
              (reasons[selected.layerId]?.length ? (
                <ul className="reason-list">
                  {reasons[selected.layerId].map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                <div className="dim">none</div>
              ))}
            {selected.transform && selected.transform.length === 16 && (
              <>
                <h4>Transform (column-major)</h4>
                <div className="layer-transform">
                  {[0, 1, 2, 3].map((row) => (
                    <div key={row}>
                      {[0, 1, 2, 3]
                        .map((col) => selected.transform![row + col * 4].toFixed(3))
                        .join('  ')}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="layers-map">
          <h3>Layer map (viewport)</h3>
          <LayerMap layers={layers} selectedId={selectedId} flash={paintFlash} />
        </div>
      </div>
    </div>
  );
}

function LayerMap({
  layers,
  selectedId,
  flash,
}: {
  layers: Layer[];
  selectedId: string | null;
  flash: LayerPainted | null;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Compute a viewBox covering all layer rects.
  const bbox = useMemo(() => {
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    for (const l of layers) {
      if (l.invisible || l.width === 0 || l.height === 0) continue;
      if (l.offsetX < minX) minX = l.offsetX;
      if (l.offsetY < minY) minY = l.offsetY;
      if (l.offsetX + l.width > maxX) maxX = l.offsetX + l.width;
      if (l.offsetY + l.height > maxY) maxY = l.offsetY + l.height;
    }
    if (maxX === 0 && maxY === 0) {
      maxX = 1280;
      maxY = 800;
    }
    return { minX, minY, maxX, maxY };
  }, [layers]);

  const flashFreshness = useFlashFade(flash);

  return (
    <svg
      ref={ref}
      className="layer-map"
      viewBox={`${bbox.minX} ${bbox.minY} ${bbox.maxX - bbox.minX} ${bbox.maxY - bbox.minY}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {layers.map((l) => {
        if (l.width === 0 || l.height === 0) return null;
        const isSel = l.layerId === selectedId;
        const stroke = isSel ? '#58a6ff' : l.invisible ? '#30363d' : 'rgba(139,148,158,0.6)';
        const fill = !l.drawsContent
          ? 'transparent'
          : isSel
          ? 'rgba(88,166,255,0.18)'
          : 'rgba(63,185,80,0.06)';
        return (
          <rect
            key={l.layerId}
            x={l.offsetX}
            y={l.offsetY}
            width={l.width}
            height={l.height}
            stroke={stroke}
            strokeWidth={isSel ? 4 : 1.5}
            fill={fill}
            style={{ cursor: 'pointer' }}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {flash && flashFreshness > 0 && (
        <rect
          x={flash.x}
          y={flash.y}
          width={flash.width}
          height={flash.height}
          stroke="#f85149"
          strokeWidth={3}
          fill="rgba(248,81,73,0.18)"
          opacity={flashFreshness}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* tiny preview label so SVG isn't blank when there are no layers */}
      {layers.length === 0 && (
        <text x={20} y={40} fill="#8b949e" fontSize={20}>
          (no layer tree yet)
        </text>
      )}
      <></>
      {/* unused size to silence linter */}
      <title>{`${size.w}×${size.h}`}</title>
    </svg>
  );
}

// Fade a paint-flash overlay over ~600ms (Chrome DevTools-like).
function useFlashFade(flash: LayerPainted | null): number {
  const [now, setNow] = useState(Date.now());
  const startedAtRef = useRef(0);
  useEffect(() => {
    if (!flash) return;
    startedAtRef.current = Date.now();
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const stop = window.setTimeout(() => cancelAnimationFrame(raf), 700);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(stop);
    };
  }, [flash]);
  if (!flash) return 0;
  const dt = now - startedAtRef.current;
  if (dt < 0 || dt > 600) return 0;
  return 1 - dt / 600;
}
