import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { openDb, setCoverage, upsertAdvisory, upsertIssue } from '../src/db/index.ts';
import { loadRegistry, loadTaxonomy } from '../src/config.ts';
import { aggregate } from '../src/aggregate/monthly.ts';
import { mergeAdvisories } from '../src/domain/dedup.ts';
import { demoAdvisories, demoIssues } from '../src/demo/fixtures.ts';
import type { NormalizedAdvisory, NormalizedIssue } from '../src/domain/types.ts';

const taxonomy = loadTaxonomy(resolve(import.meta.dir, '../config/taxonomy.json'));
const registry = loadRegistry(resolve(import.meta.dir, '../config/registry.json'));

function advisory(overrides: Partial<NormalizedAdvisory>): NormalizedAdvisory {
  return {
    ghsa_id: 'GHSA-x',
    cve_id: null,
    summary: '',
    severity: 'high',
    cvss_score: null,
    review_state: 'reviewed',
    published_at: '2026-01-05T00:00:00Z',
    modified_at: '2026-01-05T00:00:00Z',
    withdrawn_at: null,
    origin: 'github',
    html_url: null,
    aliases: [],
    cwes: ['CWE-79'],
    packages: [{ package_name: 'lodash', ecosystem: 'npm', vulnerable_range: null, patched_version: null }],
    ...overrides,
  };
}

function issue(overrides: Partial<NormalizedIssue>): NormalizedIssue {
  return {
    repository: 'lodash/lodash',
    number: 1,
    package_name: 'lodash',
    title: '',
    state: 'open',
    state_reason: null,
    is_pull_request: false,
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
    closed_at: null,
    labels: ['bug'],
    html_url: null,
    ...overrides,
  };
}

function insert(db: Database, items: NormalizedAdvisory[], observedAt = '2026-04-01T00:00:00Z') {
  for (const item of mergeAdvisories(items)) {
    upsertAdvisory(db, item, {
      runId: 'test',
      taxonomy,
      registryVersion: registry.registry_version,
      observedAt,
    });
  }
}

const RANGE = { from: '2026-01', to: '2026-03' };

describe('月次集計の不変条件', () => {
  let db: Database;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  test('主分類の合計が全体件数と一致する', () => {
    insert(db, [
      advisory({ ghsa_id: 'G1', aliases: ['G1'], cwes: ['CWE-79'] }),
      advisory({ ghsa_id: 'G2', aliases: ['G2'], cwes: ['CWE-78'] }),
      advisory({ ghsa_id: 'G3', aliases: ['G3'], cwes: [] }),
    ]);
    const result = aggregate(db, taxonomy, registry, RANGE);
    for (const row of result.byCategory) {
      const sum = result.categoryIds.reduce((acc, id) => acc + (row.counts[id] ?? 0), 0);
      expect(sum).toBe(row.total);
    }
    expect(result.byCategory[0]!.total).toBe(3);
  });

  test('再取得しても件数が増えない（同じ advisory の再投入）', () => {
    const items = [advisory({ ghsa_id: 'G1', aliases: ['G1'] })];
    insert(db, items);
    const first = aggregate(db, taxonomy, registry, RANGE).byCategory[0]!.total;
    insert(db, items);
    insert(db, items);
    const second = aggregate(db, taxonomy, registry, RANGE).byCategory[0]!.total;
    expect(second).toBe(first);
    expect(second).toBe(1);
  });

  test('公開月で数えるため、翌月の更新では新規が増えない', () => {
    insert(db, [advisory({ ghsa_id: 'G1', aliases: ['G1'], published_at: '2026-01-05T00:00:00Z' })]);
    insert(db, [
      advisory({
        ghsa_id: 'G1',
        aliases: ['G1'],
        published_at: '2026-01-05T00:00:00Z',
        modified_at: '2026-02-20T00:00:00Z',
      }),
    ]);
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.byCategory[0]!.total).toBe(1); // 2026-01
    expect(result.byCategory[1]!.total).toBe(0); // 2026-02 は 0 件
  });

  test('撤回された advisory は新規件数に加算しない', () => {
    insert(db, [
      advisory({ ghsa_id: 'G1', aliases: ['G1'] }),
      advisory({ ghsa_id: 'G2', aliases: ['G2'], withdrawn_at: '2026-02-01T00:00:00Z' }),
    ]);
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.byCategory[0]!.total).toBe(1);
    expect(result.quality.withdrawnExcluded).toBe(1);
  });

  test('複数パッケージに影響しても全体件数は 1、パッケージ別は各 1', () => {
    insert(db, [
      advisory({
        ghsa_id: 'G1',
        aliases: ['G1'],
        packages: [
          { package_name: 'lodash', ecosystem: 'npm', vulnerable_range: null, patched_version: null },
          { package_name: 'axios', ecosystem: 'npm', vulnerable_range: null, patched_version: null },
        ],
      }),
    ]);
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.byCategory[0]!.total).toBe(1);
    expect(result.byPackage.filter((p) => p.month === '2026-01')).toHaveLength(2);
    expect(result.byPackage.every((p) => p.count === 1)).toBe(true);
  });

  test('重大度は内容分類とは別軸で、同じ全体件数になる', () => {
    insert(db, [
      advisory({ ghsa_id: 'G1', aliases: ['G1'], severity: 'critical' }),
      advisory({ ghsa_id: 'G2', aliases: ['G2'], severity: 'low', cwes: ['CWE-78'] }),
    ]);
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.bySeverity[0]!.total).toBe(result.byCategory[0]!.total);
    expect(result.bySeverity[0]!.counts.critical).toBe(1);
    expect(result.bySeverity[0]!.counts.low).toBe(1);
  });

  test('対象期間の外は集計しない', () => {
    insert(db, [
      advisory({ ghsa_id: 'G1', aliases: ['G1'], published_at: '2025-12-31T23:59:59Z' }),
      advisory({ ghsa_id: 'G2', aliases: ['G2'], published_at: '2026-01-01T00:00:00Z' }),
    ]);
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]!.ghsa_id).toBe('G2');
  });
});

describe('観測時点の再現（as-of）', () => {
  let db: Database;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  test('把握した時点より後に収集した advisory は含めない', () => {
    insert(db, [advisory({ ghsa_id: 'G1', aliases: ['G1'] })], '2026-02-01T00:00:00Z');
    insert(db, [advisory({ ghsa_id: 'G2', aliases: ['G2'] })], '2026-03-01T00:00:00Z');

    const asOfFeb = aggregate(db, taxonomy, registry, { ...RANGE, asOf: '2026-02-15T00:00:00Z' });
    expect(asOfFeb.details).toHaveLength(1);

    const current = aggregate(db, taxonomy, registry, RANGE);
    expect(current.details).toHaveLength(2);
  });

  test('撤回前の時点では、撤回された advisory も計上されていた', () => {
    insert(
      db,
      [advisory({ ghsa_id: 'G1', aliases: ['G1'], withdrawn_at: '2026-03-01T00:00:00Z' })],
      '2026-01-10T00:00:00Z',
    );
    const before = aggregate(db, taxonomy, registry, { ...RANGE, asOf: '2026-02-01T00:00:00Z' });
    expect(before.details).toHaveLength(1);

    const now = aggregate(db, taxonomy, registry, RANGE);
    expect(now.details).toHaveLength(0);
  });
});

describe('不具合（Issue）の集計', () => {
  let db: Database;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  const add = (item: NormalizedIssue) => upsertIssue(db, item, { registry, observedAt: '2026-04-01T00:00:00Z' });

  test('PR は不具合件数に数えない', () => {
    add(issue({ number: 1 }));
    add(issue({ number: 2, is_pull_request: true }));
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.issuesCreated[0]!.total).toBe(1);
  });

  test('bug ラベルが無い Issue は数えない（判定は集計時）', () => {
    add(issue({ number: 1, labels: ['question'] }));
    add(issue({ number: 2, labels: ['bug'] }));
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.issuesCreated[0]!.total).toBe(1);
  });

  test('ラベルが後から外れると、再取り込みで件数から外れる', () => {
    add(issue({ number: 1, labels: ['bug'] }));
    expect(aggregate(db, taxonomy, registry, RANGE).issuesCreated[0]!.total).toBe(1);
    add(issue({ number: 1, labels: [] }));
    expect(aggregate(db, taxonomy, registry, RANGE).issuesCreated[0]!.total).toBe(0);
  });

  test('reported / confirmed / duplicate / invalid を区別する', () => {
    add(issue({ number: 1, labels: ['bug'] }));
    add(issue({ number: 2, labels: ['bug', 'confirmed'] }));
    add(issue({ number: 3, labels: ['bug', 'duplicate'] }));
    add(issue({ number: 4, labels: ['bug', 'invalid'] }));
    const counts = aggregate(db, taxonomy, registry, RANGE).issuesCreated[0]!.counts;
    expect(counts).toEqual({ reported: 1, confirmed: 1, duplicate: 1, invalid: 1 });
  });

  test('not_planned のクローズは修正ではなく invalid として扱う', () => {
    add(issue({ number: 1, state: 'closed', state_reason: 'not_planned', closed_at: '2026-01-20T00:00:00Z' }));
    const counts = aggregate(db, taxonomy, registry, RANGE).issuesCreated[0]!.counts;
    expect(counts.invalid).toBe(1);
    expect(counts.reported).toBe(0);
  });

  test('月末未解決数は、その月末時点で開いていたものを数える', () => {
    // 1 月に作成、2 月にクローズ → 1 月末は未解決、2 月末は解決済み。
    add(issue({ number: 1, state: 'closed', state_reason: 'completed', closed_at: '2026-02-10T00:00:00Z' }));
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.issuesOpenAtMonthEnd[0]!.count).toBe(1); // 2026-01
    expect(result.issuesOpenAtMonthEnd[1]!.count).toBe(0); // 2026-02
  });

  test('月末未解決に duplicate / invalid は含めない', () => {
    add(issue({ number: 1, labels: ['bug', 'duplicate'] }));
    add(issue({ number: 2, labels: ['bug', 'invalid'] }));
    add(issue({ number: 3, labels: ['bug'] }));
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.issuesOpenAtMonthEnd[0]!.count).toBe(1);
  });
});

describe('品質指標', () => {
  test('欠測は 0 件と区別して残る', () => {
    const db = openDb(':memory:');
    setCoverage(db, 'github_issues', 'webpack', '2026-02', 'missing', '取得不能');
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.quality.missingCoverage).toHaveLength(1);
    expect(result.quality.missingCoverage[0]!.scope).toBe('webpack');
    // 欠測があっても、その月の件数自体は 0 として表示される。
    expect(result.byCategory[1]!.total).toBe(0);
  });

  test('未分類率を件数から算出する', () => {
    const db = openDb(':memory:');
    insert(db, [
      advisory({ ghsa_id: 'G1', aliases: ['G1'], cwes: ['CWE-79'] }),
      advisory({ ghsa_id: 'G2', aliases: ['G2'], cwes: [] }),
    ]);
    const result = aggregate(db, taxonomy, registry, RANGE);
    expect(result.quality.unclassifiedRate).toBeCloseTo(0.5);
    expect(result.quality.targetPackages).toBe(registry.packages.length);
  });
});

describe('説明用の架空データ', () => {
  test('スライドの例と同じ内訳になる（XSS 3/5/2・資源枯渇 2/3/2・未分類 1/1/1）', () => {
    const db = openDb(':memory:');
    insert(db, demoAdvisories());
    for (const item of demoIssues()) upsertIssue(db, item, { registry, observedAt: '2026-04-01T00:00:00Z' });
    const result = aggregate(db, taxonomy, registry, RANGE);

    expect(result.byCategory.map((r) => r.counts.xss)).toEqual([3, 5, 2]);
    expect(result.byCategory.map((r) => r.counts.resource)).toEqual([2, 3, 2]);
    expect(result.byCategory.map((r) => r.counts.unclassified)).toEqual([1, 1, 1]);
    expect(result.byCategory.map((r) => r.total)).toEqual([6, 9, 5]);
  });
});
