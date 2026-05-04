// Mirrors pkg/events/types.go — keep in sync if you change either side.

export type EventKind =
  | 'network.request'
  | 'network.response'
  | 'network.finished'
  | 'network.failed'
  | 'console'
  | 'log'
  | 'exception'
  | 'perf.metrics'
  | 'perf.monitor'
  | 'page.lifecycle'
  | 'page.navigated'
  | 'meta';

export interface PIEvent<T = unknown> {
  time: string;
  kind: EventKind;
  source: 'chromedp' | 'rod' | 'raw';
  target?: string;
  data: T;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  headers?: Record<string, string>;
}
export interface NetworkResponse {
  requestId: string;
  url: string;
  status: number;
  statusText?: string;
  mimeType?: string;
  fromCache?: boolean;
  protocol?: string;
}
export interface NetworkFailed {
  requestId: string;
  errorText: string;
  canceled?: boolean;
}
export interface ConsoleEntry {
  level: string;
  text: string;
  url?: string;
  line?: number;
}
export interface PerfMonitorSample {
  title: string;
  metrics: Record<string, number>;
}

export interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface State {
  running: boolean;
  source?: string;
  startedAt?: string;
  eventCount: number;
  recorderPath?: string;
}
