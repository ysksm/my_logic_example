import type { AggregateResult } from '../aggregate/monthly.ts';
import { SEVERITIES } from '../domain/types.ts';

function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\n') + '\n';
}

/** 月次 × 内容別カテゴリ。合計列は全体件数と一致する。 */
export function categoryCsv(result: AggregateResult): string {
  const header = ['month', ...result.categoryIds.map((id) => result.categoryLabels[id] ?? id), 'total'];
  const rows = result.byCategory.map((row) => [
    row.month,
    ...result.categoryIds.map((id) => row.counts[id] ?? 0),
    row.total,
  ]);
  return toCsv([header, ...rows]);
}

export function severityCsv(result: AggregateResult): string {
  const header = ['month', ...SEVERITIES, 'total'];
  const rows = result.bySeverity.map((row) => [
    row.month,
    ...SEVERITIES.map((s) => row.counts[s]),
    row.total,
  ]);
  return toCsv([header, ...rows]);
}

export function packageCsv(result: AggregateResult): string {
  const header = ['package', 'month', 'count'];
  const rows = result.byPackage.map((row) => [row.package_name, row.month, row.count]);
  return toCsv([header, ...rows]);
}

export function issuesCsv(result: AggregateResult): string {
  const header = ['month', 'reported', 'confirmed', 'duplicate', 'invalid', 'total', 'open_at_month_end'];
  const rows = result.issuesCreated.map((row, i) => [
    row.month,
    row.counts.reported ?? 0,
    row.counts.confirmed ?? 0,
    row.counts.duplicate ?? 0,
    row.counts.invalid ?? 0,
    row.total,
    result.issuesOpenAtMonthEnd[i]?.count ?? 0,
  ]);
  return toCsv([header, ...rows]);
}

/** 明細：ID・影響範囲・原典リンクまで辿れるようにする。 */
export function detailCsv(result: AggregateResult): string {
  const header = [
    'ghsa_id',
    'cve_id',
    'published_at',
    'modified_at',
    'severity',
    'category',
    'cwes',
    'packages',
    'summary',
    'url',
  ];
  const rows = result.details.map((d) => [
    d.ghsa_id,
    d.cve_id,
    d.published_at,
    d.modified_at,
    d.severity,
    result.categoryLabels[d.category_id] ?? d.category_id,
    d.cwes,
    d.packages,
    d.summary,
    d.html_url,
  ]);
  return toCsv([header, ...rows]);
}
