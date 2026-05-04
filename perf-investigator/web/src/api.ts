// Tiny REST + WS client for the Go hub. The same module powers the Wails
// build — when window.go is present, calls are routed through the Wails
// bridge instead of HTTP.
import type { CDPTarget, PIEvent, State } from './types';

declare global {
  interface Window {
    go?: any;
  }
}

export interface StartParams {
  source: 'raw' | 'chromedp' | 'rod';
  host: string;
  port: number;
  targetIndex: number;
  navigateUrl?: string;
  network: boolean;
  console: boolean;
  performance: boolean;
  perfMonitor: boolean;
  lifecycle: boolean;
}

const base = '';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export const api = {
  listTargets(host = 'localhost', port = 9222): Promise<CDPTarget[]> {
    return http(`/api/targets?host=${host}&port=${port}`);
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
  snapshot(): Promise<{ metrics: Record<string, number> }> {
    return http('/api/snapshot', { method: 'POST' });
  },
};

export function openEventStream(onEvent: (e: PIEvent) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws`;
  const ws = new WebSocket(url);
  ws.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      // ignore
    }
  };
  return () => ws.close();
}
