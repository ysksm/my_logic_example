import type { CDPTarget, CDTEvent, State } from './types';

export interface LaunchParams {
  url?: string;
  headless?: boolean;
  execPath?: string;
  port?: number;
}

export interface StartParams {
  host?: string;
  port?: number;
  targetIndex: number;
  navigateUrl?: string;
  network: boolean;
  console: boolean;
  performance: boolean;
  perfIntervalMs?: number;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export const api = {
  launch(p: LaunchParams = {}): Promise<State> {
    return http('/api/launch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
  },
  shutdown(): Promise<State> {
    return http('/api/shutdown', { method: 'POST' });
  },
  list(host?: string, port?: number): Promise<CDPTarget[]> {
    const q = new URLSearchParams();
    if (host) q.set('host', host);
    if (port) q.set('port', String(port));
    const qs = q.toString();
    return http(qs ? `/api/list?${qs}` : '/api/list');
  },
  start(p: StartParams): Promise<State> {
    return http('/api/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
  },
  stop(): Promise<State> {
    return http('/api/stop', { method: 'POST' });
  },
  state(): Promise<State> {
    return http('/api/state');
  },
  snapshot(): Promise<{ title: string; metrics: Record<string, number> }> {
    return http('/api/snapshot', { method: 'POST' });
  },
  throttle(p: ThrottleParams): Promise<ThrottleParams> {
    return http('/api/throttle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
  },
  traceStart(p: TraceStartParams = {}): Promise<{ recording: boolean }> {
    return http('/api/trace/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
  },
  traceStop(): Promise<TraceFile> {
    return http('/api/trace/stop', { method: 'POST' });
  },
  render(p: RenderParams): Promise<RenderResult> {
    return http('/api/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
  },
};

export type NetworkPreset =
  | 'online'
  | 'offline'
  | 'slow-3g'
  | 'fast-3g'
  | 'slow-4g'
  | 'fast-4g';

export interface ThrottleParams {
  networkPreset?: NetworkPreset;
  cpuRate?: number;
}

export interface TraceStartParams {
  categories?: string[];
}

export interface TraceFile {
  traceEvents: unknown[];
  metadata?: Record<string, unknown>;
}

export interface RenderParams {
  // Overlay debugging
  paintFlashing: boolean;
  layoutShiftRegions: boolean;
  layerBorders: boolean;
  fpsCounter: boolean;
  scrollBottleneckRects: boolean;
  adHighlights: boolean;
  webVitals: boolean;

  // CSS media
  emulatedMedia?: '' | 'screen' | 'print';
  prefersColorScheme?: '' | 'light' | 'dark';
  prefersReducedMotion?: '' | 'reduce' | 'no-preference';
  prefersReducedData?: '' | 'reduce' | 'no-preference';
  prefersReducedTransparency?: '' | 'reduce' | 'no-preference';
  prefersContrast?: '' | 'more' | 'less' | 'custom' | 'no-preference';
  forcedColors?: '' | 'active' | 'none';
  colorGamut?: '' | 'srgb' | 'p3' | 'rec2020';

  visionDeficiency?:
    | 'none'
    | 'achromatopsia'
    | 'blurredVision'
    | 'deuteranopia'
    | 'protanopia'
    | 'tritanopia'
    | 'reducedContrast';

  autoDarkMode: boolean;

  localFontsDisabled: boolean;
  disabledImageTypes?: ('avif' | 'webp')[];
}

export interface RenderResult {
  applied: RenderParams;
  warnings?: string[];
}

export const defaultRenderParams: RenderParams = {
  paintFlashing: false,
  layoutShiftRegions: false,
  layerBorders: false,
  fpsCounter: false,
  scrollBottleneckRects: false,
  adHighlights: false,
  webVitals: false,
  emulatedMedia: '',
  prefersColorScheme: '',
  prefersReducedMotion: '',
  prefersReducedData: '',
  prefersReducedTransparency: '',
  prefersContrast: '',
  forcedColors: '',
  colorGamut: '',
  visionDeficiency: 'none',
  autoDarkMode: false,
  localFontsDisabled: false,
  disabledImageTypes: [],
};

export function openEventStream(onEvent: (e: CDTEvent) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      // ignore
    }
  };
  return () => ws.close();
}
