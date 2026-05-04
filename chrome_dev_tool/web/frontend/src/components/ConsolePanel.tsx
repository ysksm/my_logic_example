import { useMemo, useState } from 'react';

export type ConsoleRow = {
  time: string;
  level: string;
  text: string;
  kind: 'console' | 'log' | 'exception';
  url?: string;
  line?: number;
};

const LEVEL_BUCKETS = ['error', 'warning', 'info', 'log', 'debug'] as const;
type LevelBucket = (typeof LEVEL_BUCKETS)[number];

function bucketOf(level: string): LevelBucket {
  const l = level.toLowerCase();
  if (l === 'error' || l === 'exception' || l === 'severe') return 'error';
  if (l === 'warn' || l === 'warning') return 'warning';
  if (l === 'info') return 'info';
  if (l === 'debug' || l === 'verbose' || l === 'trace') return 'debug';
  return 'log';
}

export function ConsolePanel({
  rows,
  onClear,
}: {
  rows: ConsoleRow[];
  onClear: () => void;
}) {
  const [enabled, setEnabled] = useState<Record<LevelBucket, boolean>>({
    error: true,
    warning: true,
    info: true,
    log: true,
    debug: true,
  });
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | 'console' | 'log' | 'exception'>('all');

  const counts = useMemo(() => {
    const c: Record<LevelBucket, number> = {
      error: 0,
      warning: 0,
      info: 0,
      log: 0,
      debug: 0,
    };
    for (const r of rows) c[bucketOf(r.level)]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!enabled[bucketOf(r.level)]) return false;
      if (kind !== 'all' && r.kind !== kind) return false;
      if (q && !r.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, enabled, search, kind]);

  const view = filtered.slice().reverse().slice(0, 1000);

  return (
    <div className="tab-pane">
      <div className="subbar">
        <label>filter</label>
        <input
          placeholder="text contains…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
        />
        <label>source</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">all</option>
          <option value="console">console.*</option>
          <option value="log">Log.entryAdded</option>
          <option value="exception">exceptions</option>
        </select>
        <div className="checks">
          {LEVEL_BUCKETS.map((b) => (
            <label key={b}>
              <input
                type="checkbox"
                checked={enabled[b]}
                onChange={(e) => setEnabled({ ...enabled, [b]: e.target.checked })}
              />
              <span className={`bucket ${b}`}>
                {b} ({counts[b]})
              </span>
            </label>
          ))}
        </div>
        <span className="dim">
          showing {filtered.length}/{rows.length}
        </span>
        <button onClick={onClear}>Clear</button>
      </div>
      <div className="list">
        {view.length === 0 ? (
          <div className="empty">no entries</div>
        ) : (
          view.map((e, i) => {
            const bucket = bucketOf(e.level);
            return (
              <div key={i} className={`console-line ${bucket} ${e.kind}`}>
                <span className="muted">{e.time.slice(11, 23)}</span>{' '}
                <span className={`level-tag ${bucket}`}>{e.level.toUpperCase()}</span>{' '}
                <span className="muted">[{e.kind}]</span>{' '}
                {e.text}
                {e.url && (
                  <span className="muted">
                    {' '}
                    @ {e.url}
                    {e.line ? `:${e.line}` : ''}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
