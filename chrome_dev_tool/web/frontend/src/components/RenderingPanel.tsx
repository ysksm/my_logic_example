import { useEffect, useRef, useState } from 'react';
import { api, defaultRenderParams, type RenderParams } from '../api';

type CheckboxKey =
  | 'paintFlashing'
  | 'layoutShiftRegions'
  | 'layerBorders'
  | 'fpsCounter'
  | 'scrollBottleneckRects'
  | 'adHighlights'
  | 'webVitals';

const CHECKBOXES: { key: CheckboxKey; label: string; hint?: string }[] = [
  { key: 'paintFlashing', label: 'ペイント点滅', hint: 'Overlay.setShowPaintRects' },
  { key: 'layoutShiftRegions', label: 'レイアウトシフト領域', hint: 'Overlay.setShowLayoutShiftRegions' },
  { key: 'layerBorders', label: 'レイヤの枠線', hint: 'Overlay.setShowDebugBorders' },
  { key: 'fpsCounter', label: 'FPS メーター (Frame Rendering Stats)', hint: 'Overlay.setShowFPSCounter' },
  { key: 'scrollBottleneckRects', label: 'スクロールパフォーマンス問題', hint: 'Overlay.setShowScrollBottleneckRects' },
  { key: 'adHighlights', label: '広告フレームをハイライト', hint: 'Overlay.setShowAdHighlights' },
  { key: 'webVitals', label: 'Core Web Vitals', hint: 'Overlay.setShowWebVitals' },
];

type Sel = { value: string; label: string };

const MEDIA_OPTS: Sel[] = [
  { value: '', label: 'no override' },
  { value: 'screen', label: 'screen' },
  { value: 'print', label: 'print' },
];
const COLOR_SCHEME_OPTS: Sel[] = [
  { value: '', label: 'no override' },
  { value: 'light', label: 'light' },
  { value: 'dark', label: 'dark' },
];
const REDUCED_OPTS: Sel[] = [
  { value: '', label: 'no override' },
  { value: 'reduce', label: 'reduce' },
  { value: 'no-preference', label: 'no-preference' },
];
const CONTRAST_OPTS: Sel[] = [
  { value: '', label: 'no override' },
  { value: 'more', label: 'more' },
  { value: 'less', label: 'less' },
  { value: 'custom', label: 'custom' },
  { value: 'no-preference', label: 'no-preference' },
];
const FORCED_COLORS_OPTS: Sel[] = [
  { value: '', label: 'no override' },
  { value: 'active', label: 'active' },
  { value: 'none', label: 'none' },
];
const COLOR_GAMUT_OPTS: Sel[] = [
  { value: '', label: 'no override' },
  { value: 'srgb', label: 'srgb' },
  { value: 'p3', label: 'p3' },
  { value: 'rec2020', label: 'rec2020' },
];
const VISION_OPTS: Sel[] = [
  { value: 'none', label: 'no emulation' },
  { value: 'blurredVision', label: 'Blurred vision' },
  { value: 'reducedContrast', label: 'Reduced contrast' },
  { value: 'achromatopsia', label: 'Achromatopsia (no color)' },
  { value: 'deuteranopia', label: 'Deuteranopia (red-green)' },
  { value: 'protanopia', label: 'Protanopia (red-green)' },
  { value: 'tritanopia', label: 'Tritanopia (blue-yellow)' },
];
// Modern Chrome only accepts "avif" and "webp" for setDisabledImageTypes.
// JXL was removed when Chrome dropped JPEG XL support.
const IMAGE_TYPES = ['avif', 'webp'] as const;

export function RenderingPanel() {
  const [params, setParams] = useState<RenderParams>(defaultRenderParams);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const lastSentRef = useRef<string>('');

  // Apply on every change (debounced ~120ms so rapid select scrubs collapse).
  useEffect(() => {
    const serialized = JSON.stringify(params);
    if (serialized === lastSentRef.current) return;
    const t = window.setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.render(params);
        setWarnings(res.warnings ?? []);
        lastSentRef.current = serialized;
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [params]);

  function setBool<K extends CheckboxKey>(k: K, v: boolean) {
    setParams((p) => ({ ...p, [k]: v }));
  }

  function setStr<K extends keyof RenderParams>(k: K, v: RenderParams[K]) {
    setParams((p) => ({ ...p, [k]: v }));
  }

  function toggleImageType(t: (typeof IMAGE_TYPES)[number], on: boolean) {
    const current = new Set(params.disabledImageTypes ?? []);
    if (on) current.add(t);
    else current.delete(t);
    setParams((p) => ({
      ...p,
      disabledImageTypes: Array.from(current) as RenderParams['disabledImageTypes'],
    }));
  }

  function reset() {
    setParams(defaultRenderParams);
  }

  return (
    <div className="tab-pane perf-lab">
      <div className="subbar">
        <span className="dim">
          Chrome DevTools の Rendering パネル相当。各トグルは即座に
          attach 中の Chromium に反映されます。
          {busy && <span> · applying…</span>}
        </span>
        <button onClick={reset} disabled={busy}>
          Reset
        </button>
      </div>

      <div className="lab-grid">
        <section className="lab-card">
          <h3>可視化デバッグ</h3>
          <p className="dim">CDP の Overlay ドメイン経由でブラウザ自身が描画する。</p>
          {CHECKBOXES.map((c) => (
            <label className="render-check" key={c.key} title={c.hint}>
              <input
                type="checkbox"
                checked={params[c.key]}
                onChange={(e) => setBool(c.key, e.target.checked)}
              />
              <span>{c.label}</span>
              <code className="render-hint">{c.hint}</code>
            </label>
          ))}
        </section>

        <section className="lab-card">
          <h3>CSS メディアエミュレーション</h3>
          <p className="dim">Emulation.setEmulatedMedia (media + features)</p>
          <SelectRow label="media type" value={params.emulatedMedia ?? ''} opts={MEDIA_OPTS}
            onChange={(v) => setStr('emulatedMedia', v as RenderParams['emulatedMedia'])} />
          <SelectRow label="prefers-color-scheme" value={params.prefersColorScheme ?? ''} opts={COLOR_SCHEME_OPTS}
            onChange={(v) => setStr('prefersColorScheme', v as RenderParams['prefersColorScheme'])} />
          <SelectRow label="prefers-reduced-motion" value={params.prefersReducedMotion ?? ''} opts={REDUCED_OPTS}
            onChange={(v) => setStr('prefersReducedMotion', v as RenderParams['prefersReducedMotion'])} />
          <SelectRow label="prefers-reduced-data" value={params.prefersReducedData ?? ''} opts={REDUCED_OPTS}
            onChange={(v) => setStr('prefersReducedData', v as RenderParams['prefersReducedData'])} />
          <SelectRow label="prefers-reduced-transparency" value={params.prefersReducedTransparency ?? ''} opts={REDUCED_OPTS}
            onChange={(v) => setStr('prefersReducedTransparency', v as RenderParams['prefersReducedTransparency'])} />
          <SelectRow label="prefers-contrast" value={params.prefersContrast ?? ''} opts={CONTRAST_OPTS}
            onChange={(v) => setStr('prefersContrast', v as RenderParams['prefersContrast'])} />
          <SelectRow label="forced-colors" value={params.forcedColors ?? ''} opts={FORCED_COLORS_OPTS}
            onChange={(v) => setStr('forcedColors', v as RenderParams['forcedColors'])} />
          <SelectRow label="color-gamut" value={params.colorGamut ?? ''} opts={COLOR_GAMUT_OPTS}
            onChange={(v) => setStr('colorGamut', v as RenderParams['colorGamut'])} />
        </section>

        <section className="lab-card">
          <h3>視覚・テーマ</h3>
          <SelectRow label="vision deficiency" value={params.visionDeficiency ?? 'none'} opts={VISION_OPTS}
            onChange={(v) => setStr('visionDeficiency', v as RenderParams['visionDeficiency'])} />
          <label className="render-check">
            <input
              type="checkbox"
              checked={params.autoDarkMode}
              onChange={(e) => setStr('autoDarkMode', e.target.checked)}
            />
            <span>Auto dark mode</span>
            <code className="render-hint">Emulation.setAutoDarkModeOverride</code>
          </label>
          <label className="render-check">
            <input
              type="checkbox"
              checked={params.localFontsDisabled}
              onChange={(e) => setStr('localFontsDisabled', e.target.checked)}
            />
            <span>Local fonts を無効化</span>
            <code className="render-hint">Emulation.setLocalFontsEnabled</code>
          </label>
        </section>

        <section className="lab-card">
          <h3>画像形式を無効化</h3>
          <p className="dim">Emulation.setDisabledImageTypes — fallback 検証用</p>
          {IMAGE_TYPES.map((t) => (
            <label className="render-check" key={t}>
              <input
                type="checkbox"
                checked={(params.disabledImageTypes ?? []).includes(t)}
                onChange={(e) => toggleImageType(t, e.target.checked)}
              />
              <span>{t.toUpperCase()}</span>
            </label>
          ))}
        </section>

        {error && <div className="err lab-error">{error}</div>}
        {warnings.length > 0 && (
          <div className="lab-warning">
            <strong>このブラウザでは未対応のため一部スキップされました:</strong>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>
                  <code>{w}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  opts,
  onChange,
}: {
  label: string;
  value: string;
  opts: Sel[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="lab-row">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
