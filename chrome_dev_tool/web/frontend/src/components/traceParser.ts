// Minimal Chrome trace-event parser. We accept the standard
// `{traceEvents:[…]}` payload that Tracing.dataCollected feeds and Chrome
// DevTools' "Load profile" reads, then group events into per-thread lanes
// of stacked rectangles ready for canvas rendering.

export interface TraceEvent {
  ph?: string; // X | B | E | I | M | C | …
  name?: string;
  cat?: string;
  pid?: number;
  tid?: number;
  ts?: number; // microseconds (μs)
  dur?: number;
  args?: Record<string, unknown>;
}

export interface Block {
  name: string;
  cat: string;
  ts: number;
  dur: number;
  depth: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

export interface Lane {
  pid: number;
  tid: number;
  label: string;
  blocks: Block[];
  maxDepth: number;
  isMain: boolean;
}

export interface ParsedTrace {
  lanes: Lane[];
  minTs: number;
  maxTs: number;
  totalEvents: number;
  totalBlocks: number;
  categories: Map<string, number>;
}

export function parseTrace(events: unknown[]): ParsedTrace {
  const procNames = new Map<number, string>();
  const threadNames = new Map<string, string>();
  const categories = new Map<string, number>();

  for (const raw of events) {
    const e = raw as TraceEvent;
    if (e.ph === 'M') {
      if (e.name === 'process_name' && e.pid != null && (e.args as any)?.name) {
        procNames.set(e.pid, (e.args as any).name);
      }
      if (
        e.name === 'thread_name' &&
        e.pid != null &&
        e.tid != null &&
        (e.args as any)?.name
      ) {
        threadNames.set(`${e.pid}:${e.tid}`, (e.args as any).name);
      }
    }
    if (e.cat) {
      for (const c of e.cat.split(',')) {
        categories.set(c, (categories.get(c) ?? 0) + 1);
      }
    }
  }

  // Bucket per (pid, tid).
  const byThread = new Map<string, TraceEvent[]>();
  for (const raw of events) {
    const e = raw as TraceEvent;
    if (e.pid == null || e.tid == null) continue;
    if (e.ph !== 'X' && e.ph !== 'B' && e.ph !== 'E') continue;
    const key = `${e.pid}:${e.tid}`;
    let arr = byThread.get(key);
    if (!arr) {
      arr = [];
      byThread.set(key, arr);
    }
    arr.push(e);
  }

  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  let totalBlocks = 0;
  const lanes: Lane[] = [];

  for (const [key, evs] of byThread) {
    evs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    // Combine X with B/E pairs into a flat list of complete events.
    const completes: TraceEvent[] = [];
    const beStack: TraceEvent[] = [];
    for (const e of evs) {
      if (e.ph === 'X' && e.ts != null && e.dur != null) {
        completes.push(e);
      } else if (e.ph === 'B' && e.ts != null) {
        beStack.push(e);
      } else if (e.ph === 'E' && e.ts != null) {
        // Pop the latest B with matching name (best-effort).
        for (let i = beStack.length - 1; i >= 0; i--) {
          if (beStack[i].name === e.name) {
            const beg = beStack[i];
            beStack.splice(i, 1);
            completes.push({
              ph: 'X',
              name: beg.name,
              cat: beg.cat,
              pid: beg.pid,
              tid: beg.tid,
              ts: beg.ts,
              dur: (e.ts as number) - (beg.ts as number),
              args: beg.args,
            });
            break;
          }
        }
      }
    }
    completes.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

    const depthStack: { end: number }[] = [];
    const blocks: Block[] = [];
    let maxDepth = 0;
    for (const e of completes) {
      const ts = e.ts ?? 0;
      const dur = Math.max(e.dur ?? 0, 0);
      while (
        depthStack.length > 0 &&
        depthStack[depthStack.length - 1].end <= ts
      ) {
        depthStack.pop();
      }
      const depth = depthStack.length;
      depthStack.push({ end: ts + dur });
      blocks.push({
        name: e.name ?? '<unnamed>',
        cat: e.cat ?? '',
        ts,
        dur,
        depth,
        pid: e.pid ?? 0,
        tid: e.tid ?? 0,
        args: e.args,
      });
      if (depth + 1 > maxDepth) maxDepth = depth + 1;
      if (ts < minTs) minTs = ts;
      if (ts + dur > maxTs) maxTs = ts + dur;
    }

    if (blocks.length === 0) continue;
    totalBlocks += blocks.length;
    const [pidStr, tidStr] = key.split(':');
    const pid = Number(pidStr);
    const tid = Number(tidStr);
    const procName = procNames.get(pid);
    const threadName = threadNames.get(key);
    const label = `${procName ?? `pid${pid}`} / ${threadName ?? `tid${tid}`}`;
    const isMain =
      threadName?.includes('CrRendererMain') ||
      threadName?.includes('CrBrowserMain') ||
      threadName === 'CrGpuMain' ||
      false;
    lanes.push({ pid, tid, label, blocks, maxDepth, isMain });
  }

  // Main threads first, then by block count desc.
  lanes.sort((a, b) => {
    if (a.isMain && !b.isMain) return -1;
    if (!a.isMain && b.isMain) return 1;
    return b.blocks.length - a.blocks.length;
  });

  if (!isFinite(minTs)) minTs = 0;
  if (!isFinite(maxTs)) maxTs = 0;

  return {
    lanes,
    minTs,
    maxTs,
    totalEvents: events.length,
    totalBlocks,
    categories,
  };
}

// Hash a string into a stable HSL color.
export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 58%)`;
}

export function fmtMicros(us: number): string {
  if (us < 1000) return `${us.toFixed(0)} μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(2)} ms`;
  return `${(us / 1_000_000).toFixed(3)} s`;
}
