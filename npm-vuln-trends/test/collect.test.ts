import { describe, expect, test } from 'bun:test';
import { getCursor, openDb, saveRaw, setCursor } from '../src/db/index.ts';
import { normalizeGhAdvisory, normalizeSeverity } from '../src/collect/advisories.ts';
import { normalizeOsv } from '../src/collect/osv.ts';
import { normalizeIssue } from '../src/collect/issues.ts';
import { importAuditJson } from '../src/collect/audit.ts';
import { isRateLimited, parseNextLink, rateLimitWaitMs } from '../src/collect/http.ts';
import { monthEndExclusive, monthRange, overlapStart, toMonth } from '../src/domain/time.ts';

describe('差分取得の起点', () => {
  test('48 時間の重複窓を差し引く', () => {
    expect(overlapStart('2026-03-10T00:00:00Z', 48)).toBe('2026-03-08T00:00:00Z');
  });

  test('月境界は UTC で扱う', () => {
    expect(toMonth('2026-03-31T23:59:59Z')).toBe('2026-03');
    expect(monthEndExclusive('2026-03')).toBe('2026-04-01T00:00:00Z');
    expect(monthEndExclusive('2026-12')).toBe('2027-01-01T00:00:00Z');
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  test('カーソルは保存・読み出しできる', () => {
    const db = openDb(':memory:');
    expect(getCursor(db, 'github_advisories', 'npm-all')).toBeNull();
    setCursor(db, 'github_advisories', 'npm-all', '2026-03-01T00:00:00Z', 'run-1');
    expect(getCursor(db, 'github_advisories', 'npm-all')).toBe('2026-03-01T00:00:00Z');
    setCursor(db, 'github_advisories', 'npm-all', '2026-03-02T00:00:00Z', 'run-2');
    expect(getCursor(db, 'github_advisories', 'npm-all')).toBe('2026-03-02T00:00:00Z');
  });

  test('Link ヘッダから次ページを取り出す', () => {
    const link = '<https://api.github.com/advisories?page=2>; rel="next", <https://api.github.com/advisories?page=9>; rel="last"';
    expect(parseNextLink(link)).toBe('https://api.github.com/advisories?page=2');
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink('<https://x>; rel="last"')).toBeNull();
  });
});

describe('原本保存', () => {
  test('内容が同じなら重複して保存しない（ID と内容ハッシュで一意化）', () => {
    const db = openDb(':memory:');
    const input = {
      source: 'github_advisories',
      sourceKey: 'GHSA-1',
      url: 'https://example.test/1',
      runId: 'run-1',
      payload: { a: 1 },
    };
    const first = saveRaw(db, input);
    const second = saveRaw(db, input);
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.hash).toBe(first.hash);

    // 内容が変われば新しい版として残る（履歴になる）。
    const third = saveRaw(db, { ...input, payload: { a: 2 } });
    expect(third.isNew).toBe(true);

    const count = db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM raw_documents`)
      .get()!.n;
    expect(count).toBe(2);
  });
});

describe('GitHub Advisory の正規化', () => {
  const raw = {
    ghsa_id: 'GHSA-aaaa-bbbb-cccc',
    cve_id: 'CVE-2026-0001',
    summary: 'XSS in example',
    severity: 'HIGH',
    html_url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    published_at: '2026-01-10T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    withdrawn_at: null,
    type: 'reviewed',
    cwes: [{ cwe_id: 'CWE-79' }],
    identifiers: [
      { type: 'GHSA', value: 'GHSA-aaaa-bbbb-cccc' },
      { type: 'CVE', value: 'CVE-2026-0001' },
    ],
    vulnerabilities: [
      {
        package: { ecosystem: 'npm', name: 'example' },
        vulnerable_version_range: '< 1.0.0',
        first_patched_version: '1.0.0',
      },
    ],
  };

  test('alias・CWE・影響パッケージを取り出す', () => {
    const result = normalizeGhAdvisory(raw);
    expect(result.ghsa_id).toBe('GHSA-aaaa-bbbb-cccc');
    expect(result.severity).toBe('high');
    expect(result.aliases).toEqual(['CVE-2026-0001', 'GHSA-aaaa-bbbb-cccc']);
    expect(result.cwes).toEqual(['CWE-79']);
    expect(result.packages[0]!.package_name).toBe('example');
    expect(result.modified_at).toBe('2026-02-01T00:00:00Z');
  });

  test('malware / unreviewed は別系列として印を付ける', () => {
    expect(normalizeGhAdvisory({ ...raw, type: 'malware' }).review_state).toBe('malware');
    expect(normalizeGhAdvisory({ ...raw, type: 'unreviewed' }).review_state).toBe('unreviewed');
  });

  test('重大度の表記ゆれを揃える', () => {
    expect(normalizeSeverity('MODERATE')).toBe('moderate');
    expect(normalizeSeverity('medium')).toBe('moderate');
    expect(normalizeSeverity(null)).toBe('unknown');
    expect(normalizeSeverity('なにか')).toBe('unknown');
  });
});

describe('OSV の正規化', () => {
  test('alias から GHSA / CVE を取り出し、影響範囲を組み立てる', () => {
    const result = normalizeOsv({
      id: 'GHSA-xxxx-yyyy-zzzz',
      aliases: ['CVE-2026-9999'],
      summary: 'ReDoS',
      published: '2026-02-01T00:00:00Z',
      modified: '2026-02-05T00:00:00Z',
      database_specific: { severity: 'HIGH', cwe_ids: ['CWE-1333'] },
      affected: [
        {
          package: { ecosystem: 'npm', name: 'example' },
          ranges: [{ events: [{ introduced: '0' }, { fixed: '2.0.0' }] }],
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.ghsa_id).toBe('GHSA-xxxx-yyyy-zzzz');
    expect(result!.cve_id).toBe('CVE-2026-9999');
    expect(result!.packages[0]!.patched_version).toBe('2.0.0');
    expect(result!.packages[0]!.vulnerable_range).toBe('>= 0, < 2.0.0');
    expect(result!.origin).toBe('osv');
  });

  test('npm 以外のエコシステムは取り込まない', () => {
    const result = normalizeOsv({
      id: 'OSV-1',
      affected: [{ package: { ecosystem: 'PyPI', name: 'example' } }],
    });
    expect(result).toBeNull();
  });
});

describe('Issue の正規化', () => {
  test('PR に印を付け、ラベルを取り出す', () => {
    const result = normalizeIssue(
      {
        number: 42,
        title: 'bug report',
        state: 'closed',
        state_reason: 'completed',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
        closed_at: '2026-01-05T00:00:00Z',
        html_url: 'https://github.com/o/r/issues/42',
        pull_request: { url: 'x' },
        labels: [{ name: 'bug' }, 'confirmed'],
      },
      'o/r',
      'pkg',
    );
    expect(result.is_pull_request).toBe(true);
    expect(result.labels).toEqual(['bug', 'confirmed']);
    expect(result.state).toBe('closed');
  });
});

describe('npm audit の取り込み', () => {
  test('診断対象・実行時点ごとに 1 スナップショットとして残る', () => {
    const db = openDb(':memory:');
    const res = importAuditJson(
      db,
      'run-1',
      'demo',
      {
        vulnerabilities: {
          lodash: {
            name: 'lodash',
            severity: 'high',
            via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', title: 'XSS' }],
          },
        },
        metadata: { vulnerabilities: { total: 1, critical: 0, high: 1, moderate: 0, low: 0 } },
      },
      '2026-03-01T00:00:00Z',
    );
    expect(res.findings).toBe(1);

    const snapshot = db
      .query<{ total: number; high: number }, []>(`SELECT total, high FROM audit_snapshots`)
      .get()!;
    expect(snapshot.total).toBe(1);
    expect(snapshot.high).toBe(1);

    const finding = db
      .query<{ ghsa_id: string }, []>(`SELECT ghsa_id FROM audit_findings`)
      .get()!;
    expect(finding.ghsa_id).toBe('GHSA-aaaa-bbbb-cccc');
  });
});

describe('403 の扱い', () => {
  const res = (status: number, headers: Record<string, string>) => ({
    status,
    headers: new Headers(headers),
  });

  test('残量 0 の 403 はレート制限として再試行する', () => {
    expect(isRateLimited(res(403, { 'x-ratelimit-remaining': '0' }))).toBe(true);
  });

  test('retry-after 付きの 403 もレート制限として扱う', () => {
    expect(isRateLimited(res(403, { 'retry-after': '30' }))).toBe(true);
  });

  test('429 は常にレート制限', () => {
    expect(isRateLimited(res(429, {}))).toBe(true);
  });

  test('権限起因の 403 はレート制限ではない（待っても解消しない）', () => {
    expect(isRateLimited(res(403, { 'x-ratelimit-remaining': '4999' }))).toBe(false);
    expect(isRateLimited(res(403, {}))).toBe(false);
  });

  test('待ち時間は retry-after / reset から決める', () => {
    const now = 1_000_000_000_000;
    expect(rateLimitWaitMs(res(403, { 'retry-after': '30' }), now)).toBe(30_000);
    expect(rateLimitWaitMs(res(403, { 'x-ratelimit-reset': String(now / 1000 + 60) }), now)).toBe(61_000);
    expect(rateLimitWaitMs(res(403, {}), now)).toBe(60_000);
    // 既に過ぎた reset でも負の待ち時間にならない。
    expect(rateLimitWaitMs(res(403, { 'x-ratelimit-reset': '1' }), now)).toBe(1_000);
  });
});
