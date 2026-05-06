// Minimal Chrome trace-event parser. We accept the standard
// `{traceEvents:[…]}` payload that Tracing.dataCollected feeds and Chrome
// DevTools' "Load profile" reads, then group events into per-thread lanes
// of stacked rectangles ready for canvas rendering.

export interface TraceEvent {
  ph?: string; // X | B | E | I | M | C | s | t | f | …
  name?: string;
  cat?: string;
  pid?: number;
  tid?: number;
  ts?: number; // microseconds (μs)
  dur?: number;
  id?: string | number;
  args?: Record<string, unknown>;
}

export interface Block {
  id: number;          // unique within a ParsedTrace, used as map keys
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

export interface Marker {
  name: string;     // raw event name
  label: string;    // short friendly label drawn on the ruler
  ts: number;
  color: string;
  args?: Record<string, unknown>;
}

export interface Frame {
  ts: number;
  dur: number;      // estimated, derived from gap to next frame begin
}

export interface Screenshot {
  ts: number;
  // data URL ready to assign to img.src.
  dataUrl: string;
}

export interface FlowPoint {
  blockId: number;
  ph: 's' | 't' | 'f';
  ts: number;
}

export interface FlowGroup {
  id: string;        // raw flow id stringified
  name: string;
  color: string;
  points: FlowPoint[];   // sorted by ts
}

export interface BlockRef {
  block: Block;
  lane: Lane;
}

export interface ParsedTrace {
  lanes: Lane[];
  markers: Marker[];
  frames: Frame[];
  screenshots: Screenshot[];
  flows: FlowGroup[];
  // Lookup helpers populated alongside flows.
  blockFlows: Map<number, string[]>;        // blockId → flow ids
  blockById: Map<number, BlockRef>;
  minTs: number;
  maxTs: number;
  totalEvents: number;
  totalBlocks: number;
  categories: Map<string, number>;
}

// Known performance markers from disabled-by-default-devtools.timeline /
// blink.user_timing. Multiple Chromium versions use different naming.
const MARKER_DEFS: { match: (name: string) => boolean; label: string; color: string }[] = [
  { match: (n) => n === 'navigationStart', label: 'NS', color: '#8b949e' },
  { match: (n) => n === 'MarkFirstPaint' || n === 'firstPaint', label: 'FP', color: '#79c0ff' },
  { match: (n) => n === 'MarkFCP' || n === 'firstContentfulPaint', label: 'FCP', color: '#7ee787' },
  {
    match: (n) =>
      n === 'MarkLCPCandidate' ||
      n === 'largestContentfulPaint::Candidate' ||
      n === 'MarkLCP',
    label: 'LCP',
    color: '#d2a8ff',
  },
  {
    match: (n) =>
      n === 'MarkDOMContent' ||
      n === 'domContentLoadedEventEnd' ||
      n === 'domContentLoaded',
    label: 'DCL',
    color: '#ffa657',
  },
  {
    match: (n) =>
      n === 'MarkLoad' || n === 'loadEventEnd' || n === 'load',
    label: 'L',
    color: '#ff7b72',
  },
];

function classifyMarker(name: string): { label: string; color: string } | null {
  for (const def of MARKER_DEFS) {
    if (def.match(name)) return { label: def.label, color: def.color };
  }
  return null;
}

export function parseTrace(events: unknown[]): ParsedTrace {
  const procNames = new Map<number, string>();
  const threadNames = new Map<string, string>();
  const categories = new Map<string, number>();
  const markers: Marker[] = [];
  const frameStarts: number[] = [];
  const screenshots: Screenshot[] = [];
  const flowEvents: {
    id: string;
    name: string;
    ts: number;
    pid: number;
    tid: number;
    ph: 's' | 't' | 'f';
  }[] = [];

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
    // Instant / mark events that look like a known performance marker.
    if (
      (e.ph === 'I' || e.ph === 'i' || e.ph === 'R') &&
      e.name &&
      e.ts != null
    ) {
      const cls = classifyMarker(e.name);
      if (cls) {
        markers.push({
          name: e.name,
          label: cls.label,
          color: cls.color,
          ts: e.ts,
          args: e.args,
        });
      }
    }
    // Frame begins: DrawFrame in the timeline.frame category. We read the
    // start timestamp; duration is computed as the gap to the next start.
    if (e.name === 'DrawFrame' && e.ts != null) {
      frameStarts.push(e.ts);
    }
    // Flow events: link events across threads via shared id.
    if (
      (e.ph === 's' || e.ph === 't' || e.ph === 'f') &&
      e.id != null &&
      e.ts != null &&
      e.pid != null &&
      e.tid != null
    ) {
      flowEvents.push({
        id: String(e.id),
        name: e.name ?? '',
        ts: e.ts,
        pid: e.pid,
        tid: e.tid,
        ph: e.ph as 's' | 't' | 'f',
      });
    }
    // Screenshots: object snapshots in the screenshot category carry a
    // base64-encoded JPEG in args.snapshot. Older traces also use ph: 'O'.
    if (e.name === 'Screenshot' && e.ts != null) {
      const snap = (e.args as any)?.snapshot;
      if (typeof snap === 'string' && snap.length > 0) {
        screenshots.push({
          ts: e.ts,
          dataUrl: snap.startsWith('data:')
            ? snap
            : `data:image/jpeg;base64,${snap}`,
        });
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
  let nextBlockId = 0;
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
        id: nextBlockId++,
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

  // Markers may reference timestamps outside any lane block — extend bounds
  // so they remain visible in "fit all".
  for (const m of markers) {
    if (m.ts < minTs) minTs = m.ts;
    if (m.ts > maxTs) maxTs = m.ts;
  }
  markers.sort((a, b) => a.ts - b.ts);

  frameStarts.sort((a, b) => a - b);
  const frames: Frame[] = [];
  for (let i = 0; i < frameStarts.length; i++) {
    const ts = frameStarts[i];
    const next = frameStarts[i + 1];
    // Cap at 100ms so a long pause does not produce a giant block.
    const dur = next != null ? Math.min(next - ts, 100_000) : 16_667;
    if (dur <= 0) continue;
    frames.push({ ts, dur });
    if (ts < minTs) minTs = ts;
    if (ts + dur > maxTs) maxTs = ts + dur;
  }

  screenshots.sort((a, b) => a.ts - b.ts);
  for (const s of screenshots) {
    if (s.ts < minTs) minTs = s.ts;
    if (s.ts > maxTs) maxTs = s.ts;
  }

  // Build a (pid, tid) → Lane lookup for flow resolution.
  const laneByPidTid = new Map<string, Lane>();
  const blockById = new Map<number, BlockRef>();
  for (const lane of lanes) {
    laneByPidTid.set(`${lane.pid}:${lane.tid}`, lane);
    for (const b of lane.blocks) blockById.set(b.id, { block: b, lane });
  }

  // Group flow events by id and resolve each to its enclosing block.
  const groups = new Map<string, FlowGroup>();
  const blockFlows = new Map<number, string[]>();
  for (const fe of flowEvents) {
    const lane = laneByPidTid.get(`${fe.pid}:${fe.tid}`);
    if (!lane) continue;
    const enc = findEnclosingBlock(lane, fe.ts);
    if (!enc) continue;
    let g = groups.get(fe.id);
    if (!g) {
      g = {
        id: fe.id,
        name: fe.name,
        color: colorForName(`flow:${fe.id}:${fe.name}`),
        points: [],
      };
      groups.set(fe.id, g);
    } else if (!g.name && fe.name) {
      g.name = fe.name;
    }
    g.points.push({ blockId: enc.id, ph: fe.ph, ts: fe.ts });
    let arr = blockFlows.get(enc.id);
    if (!arr) {
      arr = [];
      blockFlows.set(enc.id, arr);
    }
    if (!arr.includes(fe.id)) arr.push(fe.id);
  }
  // Drop singleton groups (a flow with only one point reveals nothing).
  for (const [id, g] of groups) {
    g.points.sort((a, b) => a.ts - b.ts);
    // Deduplicate points that resolved to the same block at the same ts.
    const seen = new Set<string>();
    g.points = g.points.filter((p) => {
      const k = `${p.blockId}:${p.ph}:${p.ts}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const distinctBlocks = new Set(g.points.map((p) => p.blockId));
    if (distinctBlocks.size < 2) {
      // Cleanup the back-reference too.
      for (const p of g.points) {
        const arr = blockFlows.get(p.blockId);
        if (!arr) continue;
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1);
        if (arr.length === 0) blockFlows.delete(p.blockId);
      }
      groups.delete(id);
    }
  }
  const flows = Array.from(groups.values());

  return {
    lanes,
    markers,
    frames,
    screenshots,
    flows,
    blockFlows,
    blockById,
    minTs,
    maxTs,
    totalEvents: events.length,
    totalBlocks,
    categories,
  };
}

// Find the deepest block on `lane` whose [ts, ts+dur] contains `ts`.
function findEnclosingBlock(lane: Lane, ts: number): Block | null {
  const blocks = lane.blocks;
  if (blocks.length === 0) return null;
  // Binary search for the largest index with block.ts <= ts.
  let lo = 0;
  let hi = blocks.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].ts <= ts) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (last < 0) return null;
  // Walk backwards picking the deepest containing block. We can stop when
  // depth becomes 0 and the block has already finished (no shallower
  // ancestor can contain ts past that point).
  let best: Block | null = null;
  for (let i = last; i >= 0; i--) {
    const b = blocks[i];
    if (b.ts + b.dur < ts) {
      // This block ended before ts; any earlier block at depth>0 can still
      // contain ts via a longer outer block, so keep walking — but only
      // until we pass through depth 0 again.
      if (b.depth === 0) break;
      continue;
    }
    if (b.ts > ts) continue; // shouldn't happen post-binary-search.
    if (!best || b.depth > best.depth) best = b;
  }
  return best;
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

export interface AggregateRow {
  name: string;
  count: number;
  totalUs: number;
  selfUs: number;
}

// aggregateRange clips every block to [startUs, endUs], groups by name, and
// returns total / self time per group. self = clipped own dur − Σ clipped
// dur of immediate children (depth+1, contained in same lane).
export function aggregateRange(
  parsed: ParsedTrace,
  startUs: number,
  endUs: number,
): { rows: AggregateRow[]; totalUs: number; blockCount: number } {
  if (endUs <= startUs) {
    return { rows: [], totalUs: 0, blockCount: 0 };
  }
  const map = new Map<string, AggregateRow>();
  let totalUs = 0;
  let blockCount = 0;

  for (const lane of parsed.lanes) {
    const blocks = lane.blocks;
    // Pre-build a per-depth index of starting positions to speed child lookup.
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const bEnd = b.ts + b.dur;
      if (bEnd <= startUs) continue;
      if (b.ts >= endUs) break; // blocks are sorted by ts asc.
      const own = Math.max(0, Math.min(bEnd, endUs) - Math.max(b.ts, startUs));
      if (own <= 0) continue;
      // Sum immediate children clipped dur.
      let childUs = 0;
      for (let j = i + 1; j < blocks.length; j++) {
        const c = blocks[j];
        if (c.ts >= bEnd) break;
        if (c.depth !== b.depth + 1) continue;
        const cEnd = c.ts + c.dur;
        if (cEnd <= startUs) continue;
        if (c.ts >= endUs) break;
        childUs += Math.max(
          0,
          Math.min(cEnd, endUs) - Math.max(c.ts, startUs),
        );
      }
      const self = Math.max(0, own - childUs);
      let row = map.get(b.name);
      if (!row) {
        row = { name: b.name, count: 0, totalUs: 0, selfUs: 0 };
        map.set(b.name, row);
      }
      row.count++;
      row.totalUs += own;
      row.selfUs += self;
      totalUs += self;
      blockCount++;
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => b.selfUs - a.selfUs);
  return { rows, totalUs, blockCount };
}
