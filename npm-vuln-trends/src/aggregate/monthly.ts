import type { Database } from 'bun:sqlite';
import { monthEndExclusive, monthRange, toMonth } from '../domain/time.ts';
import { orderedCategories } from '../domain/taxonomy.ts';
import { SEVERITIES } from '../domain/types.ts';
import type { Registry, Severity, Taxonomy } from '../domain/types.ts';

/** group_concat の区切り。パッケージ名・CWE ID には現れない文字を使う。 */
const SEP = '|';

export interface AggregateOptions {
  from: string; // 'YYYY-MM'
  to: string; // 'YYYY-MM'
  /**
   * 指定すると「その時点までに収集した版」を再現する（observed_at 基準）。
   * 省略時は「現在の知識で過去を再集計する」表示になる。
   */
  asOf?: string | null;
  /** 監視対象パッケージだけに絞る。省略時は npm 全体の公開脆弱性。 */
  packagesOnly?: boolean;
}

export interface MonthlyCategoryRow {
  month: string;
  counts: Record<string, number>;
  total: number;
}

export interface AdvisoryDetail {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: Severity;
  category_id: string;
  published_at: string | null;
  modified_at: string | null;
  html_url: string | null;
  packages: string;
  cwes: string;
}

export interface QualityMetrics {
  lastSuccessAt: Record<string, string | null>;
  targetPackages: number;
  advisoriesInRange: number;
  unclassifiedRate: number;
  otherRate: number;
  withdrawnExcluded: number;
  missingCoverage: { source: string; scope: string; month: string; note: string | null }[];
  taxonomyVersion: string;
  registryVersion: string;
  asOf: string | null;
  generatedAt: string;
}

export interface AggregateResult {
  months: string[];
  categoryIds: string[];
  categoryLabels: Record<string, string>;
  byCategory: MonthlyCategoryRow[];
  bySeverity: { month: string; counts: Record<Severity, number>; total: number }[];
  byPackage: { package_name: string; month: string; count: number }[];
  issuesCreated: { month: string; counts: Record<string, number>; total: number }[];
  issuesOpenAtMonthEnd: { month: string; count: number }[];
  audit: {
    target: string;
    executed_at: string;
    total: number;
    critical: number;
    high: number;
    moderate: number;
    low: number;
  }[];
  details: AdvisoryDetail[];
  quality: QualityMetrics;
  options: AggregateOptions;
}

/**
 * 月次集計。
 *
 * 不変条件:
 *  - 主分類の合計 = 全体件数（1 advisory は 1 主分類にだけ計上される）
 *  - 同じ advisory を翌月に更新しても新規は 0（公開月 published_at で数える）
 *  - 1 advisory が複数パッケージに影響しても全体件数は 1、パッケージ別は各 1
 *  - 撤回（withdrawn）は新規件数に加算しない
 */
export function aggregate(
  db: Database,
  taxonomy: Taxonomy,
  registry: Registry,
  options: AggregateOptions,
): AggregateResult {
  const months = monthRange(options.from, options.to);
  const asOf = options.asOf ?? null;
  const categories = orderedCategories(taxonomy);
  const categoryIds = categories.map((c) => c.id);
  const categoryLabels = Object.fromEntries(categories.map((c) => [c.id, c.label]));

  const packageNames = registry.packages.map((p) => p.name);
  const rows = selectAdvisories(db, options, asOf, packageNames);

  // --- 内容別（積み上げ棒） ------------------------------------------------
  const byCategory: MonthlyCategoryRow[] = months.map((month) => ({
    month,
    counts: Object.fromEntries(categoryIds.map((id) => [id, 0])),
    total: 0,
  }));
  const bySeverity = months.map((month) => ({
    month,
    counts: Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>,
    total: 0,
  }));
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  for (const row of rows) {
    if (row.published_at === null) continue;
    const idx = monthIndex.get(toMonth(row.published_at));
    if (idx === undefined) continue;

    const categoryRow = byCategory[idx]!;
    const categoryId = categoryIds.includes(row.category_id) ? row.category_id : 'unclassified';
    categoryRow.counts[categoryId] = (categoryRow.counts[categoryId] ?? 0) + 1;
    categoryRow.total += 1;

    const severityRow = bySeverity[idx]!;
    severityRow.counts[row.severity] += 1;
    severityRow.total += 1;
  }

  // --- パッケージ別（全体件数とは別軸） ------------------------------------
  const packageCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.published_at === null) continue;
    const month = toMonth(row.published_at);
    if (!monthIndex.has(month)) continue;
    for (const name of new Set(row.package_names.filter((n) => n !== ''))) {
      const key = `${name}${SEP}${month}`;
      packageCounts.set(key, (packageCounts.get(key) ?? 0) + 1);
    }
  }
  const byPackage = [...packageCounts.entries()]
    .map(([key, count]) => {
      const [package_name = '', month = ''] = key.split(SEP);
      return { package_name, month, count };
    })
    .sort((a, b) => b.count - a.count || a.package_name.localeCompare(b.package_name));

  // --- 不具合（Issue） ------------------------------------------------------
  const { issuesCreated, issuesOpenAtMonthEnd } = aggregateIssues(db, months, asOf);

  // --- 自システムへの影響（別指標） ----------------------------------------
  const audit = db
    .query<
      {
        target: string;
        executed_at: string;
        total: number;
        critical: number;
        high: number;
        moderate: number;
        low: number;
      },
      []
    >(
      `SELECT target, executed_at, total, critical, high, moderate, low
       FROM audit_snapshots ORDER BY executed_at DESC LIMIT 50`,
    )
    .all();

  const details: AdvisoryDetail[] = rows
    .filter((r) => r.published_at !== null && monthIndex.has(toMonth(r.published_at)))
    .map((r) => ({
      ghsa_id: r.ghsa_id,
      cve_id: r.cve_id,
      summary: r.summary,
      severity: r.severity,
      category_id: r.category_id,
      published_at: r.published_at,
      modified_at: r.modified_at,
      html_url: r.html_url,
      packages: r.package_names.join(' / '),
      cwes: r.cwe_ids.join(' / '),
    }))
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));

  const quality = buildQuality(db, taxonomy, registry, details, asOf);

  return {
    months,
    categoryIds,
    categoryLabels,
    byCategory,
    bySeverity,
    byPackage,
    issuesCreated,
    issuesOpenAtMonthEnd,
    audit,
    details,
    quality,
    options,
  };
}

interface AdvisoryRow {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: Severity;
  category_id: string;
  published_at: string | null;
  modified_at: string | null;
  html_url: string | null;
  package_names: string[];
  cwe_ids: string[];
}

function selectAdvisories(
  db: Database,
  options: AggregateOptions,
  asOf: string | null,
  packageNames: string[],
): AdvisoryRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (asOf) {
    // 保存済みの観測時点の表示：その時点までに把握していた advisory だけを使う。
    where.push('a.first_seen_at <= ?');
    params.push(asOf);
    // その時点でまだ撤回されていなければ計上する。
    where.push('(a.withdrawn_at IS NULL OR a.withdrawn_at > ?)');
    params.push(asOf);
  } else {
    // 現在の知識で過去を再集計する：撤回済みは加算しない。
    where.push('a.withdrawn_at IS NULL');
  }

  if (options.packagesOnly && packageNames.length > 0) {
    const placeholders = packageNames.map(() => '?').join(', ');
    where.push(
      `EXISTS (SELECT 1 FROM advisory_packages p WHERE p.ghsa_id = a.ghsa_id AND p.package_name IN (${placeholders}))`,
    );
    params.push(...packageNames);
  }

  const sql = `
    SELECT a.ghsa_id, a.cve_id, a.summary, a.severity, a.category_id,
           a.published_at, a.modified_at, a.html_url,
           (SELECT group_concat(p.package_name, '${SEP}') FROM advisory_packages p WHERE p.ghsa_id = a.ghsa_id) AS packages,
           (SELECT group_concat(c.cwe_id, '${SEP}') FROM advisory_cwes c WHERE c.ghsa_id = a.ghsa_id) AS cwes
    FROM advisories a
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
  `;

  return db
    .query<
      {
        ghsa_id: string;
        cve_id: string | null;
        summary: string;
        severity: Severity;
        category_id: string | null;
        published_at: string | null;
        modified_at: string | null;
        html_url: string | null;
        packages: string | null;
        cwes: string | null;
      },
      (string | number)[]
    >(sql)
    .all(...params)
    .map((r) => ({
      ghsa_id: r.ghsa_id,
      cve_id: r.cve_id,
      summary: r.summary,
      severity: r.severity,
      category_id: r.category_id ?? 'unclassified',
      published_at: r.published_at,
      modified_at: r.modified_at,
      html_url: r.html_url,
      package_names: r.packages ? r.packages.split(SEP) : [],
      cwe_ids: r.cwes ? r.cwes.split(SEP) : [],
    }));
}

function aggregateIssues(
  db: Database,
  months: string[],
  asOf: string | null,
): {
  issuesCreated: { month: string; counts: Record<string, number>; total: number }[];
  issuesOpenAtMonthEnd: { month: string; count: number }[];
} {
  const states = ['reported', 'confirmed', 'duplicate', 'invalid'];
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const issuesCreated = months.map((month) => ({
    month,
    counts: Object.fromEntries(states.map((s) => [s, 0])),
    total: 0,
  }));

  // PR は除外する。bug 判定は保存時点の現在値を使う（ラベル削除も反映される）。
  const where = ['is_pull_request = 0', 'is_bug = 1'];
  const params: string[] = [];
  if (asOf) {
    where.push('first_seen_at <= ?');
    params.push(asOf);
  }

  const rows = db
    .query<{ created_at: string; closed_at: string | null; bug_state: string }, string[]>(
      `SELECT created_at, closed_at, bug_state FROM issues WHERE ${where.join(' AND ')}`,
    )
    .all(...params);

  for (const row of rows) {
    const idx = monthIndex.get(toMonth(row.created_at));
    if (idx === undefined) continue;
    const bucket = issuesCreated[idx]!;
    const state = states.includes(row.bug_state) ? row.bug_state : 'reported';
    bucket.counts[state] = (bucket.counts[state] ?? 0) + 1;
    bucket.total += 1;
  }

  // 月末未解決数。close は修正と同義ではないため、duplicate / invalid は未解決から除く。
  const issuesOpenAtMonthEnd = months.map((month) => {
    const boundary = monthEndExclusive(month);
    let count = 0;
    for (const row of rows) {
      if (row.bug_state === 'duplicate' || row.bug_state === 'invalid') continue;
      if (row.created_at >= boundary) continue;
      if (row.closed_at === null || row.closed_at >= boundary) count += 1;
    }
    return { month, count };
  });

  return { issuesCreated, issuesOpenAtMonthEnd };
}

function buildQuality(
  db: Database,
  taxonomy: Taxonomy,
  registry: Registry,
  details: AdvisoryDetail[],
  asOf: string | null,
): QualityMetrics {
  const runRows = db
    .query<{ source: string; finished_at: string | null }, []>(
      `SELECT source, MAX(finished_at) AS finished_at FROM fetch_runs WHERE status = 'success' GROUP BY source`,
    )
    .all();
  const lastSuccessAt: Record<string, string | null> = {};
  for (const source of ['github_advisories', 'osv', 'github_issues', 'npm_audit']) {
    lastSuccessAt[source] = runRows.find((r) => r.source === source)?.finished_at ?? null;
  }

  const missingCoverage = db
    .query<{ source: string; scope: string; month: string; note: string | null }, []>(
      `SELECT source, scope, month, note FROM coverage WHERE status != 'collected' ORDER BY month DESC, source`,
    )
    .all();

  const withdrawnExcluded = asOf
    ? (db
        .query<{ n: number }, [string]>(
          `SELECT COUNT(*) AS n FROM advisories WHERE withdrawn_at IS NOT NULL AND withdrawn_at <= ?`,
        )
        .get(asOf)?.n ?? 0)
    : (db
        .query<{ n: number }, []>(
          `SELECT COUNT(*) AS n FROM advisories WHERE withdrawn_at IS NOT NULL`,
        )
        .get()?.n ?? 0);

  const total = details.length;
  const unclassified = details.filter((d) => d.category_id === 'unclassified').length;
  const other = details.filter((d) => d.category_id === 'other').length;

  return {
    lastSuccessAt,
    targetPackages: registry.packages.length,
    advisoriesInRange: total,
    unclassifiedRate: total === 0 ? 0 : unclassified / total,
    otherRate: total === 0 ? 0 : other / total,
    withdrawnExcluded,
    missingCoverage,
    taxonomyVersion: taxonomy.taxonomy_version,
    registryVersion: registry.registry_version,
    asOf,
    generatedAt: new Date().toISOString(),
  };
}
