// Mirrors core/events/types.go — keep in sync.

export type EventKind =
  | 'network.request'
  | 'network.response'
  | 'network.finished'
  | 'network.failed'
  | 'console'
  | 'log'
  | 'exception'
  | 'perf.monitor'
  | 'perf.metrics'
  | 'layers.tree'
  | 'layers.painted'
  | 'meta';

export interface CDTEvent<T = unknown> {
  time: string;
  kind: EventKind;
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
  headers?: Record<string, string>;
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
export interface PerfSample {
  title: string;
  metrics: Record<string, number>;
}

export interface Layer {
  layerId: string;
  parentLayerId?: string;
  backendNodeId?: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  paintCount?: number;
  drawsContent: boolean;
  invisible?: boolean;
  transform?: number[];
  scrollRectCount?: number;
}

export interface LayerTree {
  layers: Layer[];
}

export interface LayerPainted {
  layerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  attached: boolean;
  startedAt?: string;
  eventCount: number;
  host?: string;
  port?: number;
  targetUrl?: string;
  browserPath?: string;
}
