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
