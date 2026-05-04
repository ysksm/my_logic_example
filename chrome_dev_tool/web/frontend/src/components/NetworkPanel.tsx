import { useMemo, useState } from 'react';

export type NetRow = {
  requestId: string;
  url: string;
  method: string;
  type?: string;
  status?: number;
  mimeType?: string;
  failed?: string;
  startedAt: number;
  finishedAt?: number;
  encodedDataLength?: number;
  reqHeaders?: Record<string, string>;
  resHeaders?: Record<string, string>;
};

const TYPE_FILTERS = [
  'all',
  'document',
  'stylesheet',
  'script',
  'image',
  'font',
  'xhr',
  'fetch',
  'media',
  'websocket',
  'other',
] as const;

type TypeFilter = (typeof TYPE_FILTERS)[number];

export function NetworkPanel({
  rows,
  onClear,
}: {
  rows: NetRow[];
  onClear: () => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'fail'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all') {
        if (typeFilter === 'other') {
          if (r.type && TYPE_FILTERS.includes(r.type as TypeFilter)) return false;
        } else if ((r.type ?? '').toLowerCase() !== typeFilter) {
          return false;
        }
      }
      if (statusFilter === 'ok' && r.failed) return false;
      if (statusFilter === 'fail' && !r.failed) return false;
      if (q && !r.url.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, typeFilter, statusFilter, search]);

  const counts = useMemo(() => {
    let ok = 0,
      fail = 0,
      pending = 0,
      bytes = 0;
    for (const r of rows) {
      if (r.failed) fail++;
      else if (r.status) ok++;
      else pending++;
      if (r.encodedDataLength) bytes += r.encodedDataLength;
    }
    return { ok, fail, pending, bytes, total: rows.length };
  }, [rows]);

  const detail = useMemo(
    () => filtered.find((r) => r.requestId === selected) ?? null,
    [filtered, selected],
  );

  const view = filtered.slice().reverse().slice(0, 1000);

  return (
    <div className="tab-pane net">
      <div className="subbar">
        <label>filter</label>
        <input
          placeholder="url contains…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 240 }}
        />
        <label>type</label>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
        >
          {TYPE_FILTERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label>status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ok' | 'fail')}
        >
          <option value="all">all</option>
          <option value="ok">ok only</option>
          <option value="fail">failed only</option>
        </select>
        <span className="dim">
          showing {filtered.length}/{counts.total} · ok {counts.ok} · fail{' '}
          {counts.fail} · pending {counts.pending} · {fmtBytes(counts.bytes)}
        </span>
        <button onClick={onClear}>Clear</button>
      </div>
      <div className="net-layout">
        <div className="list">
          <table>
            <thead>
              <tr>
                <th style={{ width: 64 }}>status</th>
                <th style={{ width: 64 }}>method</th>
                <th style={{ width: 90 }}>type</th>
                <th>url</th>
                <th style={{ width: 70 }}>ms</th>
                <th style={{ width: 80 }}>size</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => (
                <tr
                  key={r.requestId}
                  className={selected === r.requestId ? 'sel' : ''}
                  onClick={() => setSelected(r.requestId)}
                >
                  <td className={r.failed ? 'status-5xx' : statusClass(r.status)}>
                    {r.failed ? 'FAIL' : r.status ?? '…'}
                  </td>
                  <td>{r.method}</td>
                  <td className="muted">{r.type ?? ''}</td>
                  <td title={r.url}>{trim(r.url, 140)}</td>
                  <td className="muted">
                    {r.finishedAt ? `${r.finishedAt - r.startedAt}` : ''}
                  </td>
                  <td className="muted">
                    {r.encodedDataLength ? fmtBytes(r.encodedDataLength) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail && (
          <div className="net-detail">
            <h3>
              <span className="muted">{detail.method}</span> {detail.url}
              <button
                style={{ float: 'right' }}
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </h3>
            <DetailKV label="status" value={detail.failed ?? String(detail.status ?? '…')} />
            <DetailKV label="type" value={detail.type ?? ''} />
            <DetailKV label="mimeType" value={detail.mimeType ?? ''} />
            <DetailKV
              label="duration"
              value={detail.finishedAt ? `${detail.finishedAt - detail.startedAt} ms` : 'pending'}
            />
            <DetailKV
              label="size"
              value={detail.encodedDataLength ? fmtBytes(detail.encodedDataLength) : ''}
            />
            <Headers title="Request headers" h={detail.reqHeaders} />
            <Headers title="Response headers" h={detail.resHeaders} />
          </div>
        )}
      </div>
    </div>
  );
}

function DetailKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function Headers({ title, h }: { title: string; h?: Record<string, string> }) {
  if (!h || Object.keys(h).length === 0) return null;
  const entries = Object.entries(h).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="hdrs">
      <h4>{title}</h4>
      <table>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td className="k">{k}</td>
              <td className="v">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusClass(s?: number) {
  if (!s) return 'muted';
  if (s < 300) return 'status-2xx';
  if (s < 400) return 'status-3xx';
  if (s < 500) return 'status-4xx';
  return 'status-5xx';
}
function trim(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
