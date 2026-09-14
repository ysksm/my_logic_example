import type { AggregateResult } from '../aggregate/monthly.ts';
import { SEVERITIES } from '../domain/types.ts';
import type { Severity } from '../domain/types.ts';

/** 内容別カテゴリの色。重大度とは別の軸なので、色体系も分ける。 */
export const CATEGORY_COLORS: Record<string, string> = {
  exec: '#b23a48',
  xss: '#d9863d',
  traversal: '#c9a227',
  proto: '#4f8a5b',
  resource: '#3f7d9e',
  ssrf: '#5c6bc0',
  authz: '#8264a8',
  other: '#8a8f98',
  unclassified: '#c3c7cc',
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#8c1d2c',
  high: '#c04a2b',
  moderate: '#d9a63d',
  low: '#5b93b8',
  unknown: '#b9bec5',
};

const BUG_STATE_COLORS: Record<string, string> = {
  reported: '#3f7d9e',
  confirmed: '#b23a48',
  duplicate: '#9aa0a6',
  invalid: '#c3c7cc',
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 目盛りの上限を、切りのよい値に丸める。 */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

interface ChartGeometry {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

const DEFAULT_GEOMETRY: ChartGeometry = {
  width: 880,
  height: 340,
  padLeft: 56,
  padRight: 20,
  padTop: 24,
  padBottom: 56,
};

/**
 * 内容別の変化を積み上げ棒で示す。
 * 主分類の合計 = 全体件数なので、棒の高さがそのまま月次の全体件数になる。
 */
export function stackedBarSvg(result: AggregateResult, geo = DEFAULT_GEOMETRY): string {
  const { months, byCategory, categoryIds, categoryLabels } = result;
  const plotW = geo.width - geo.padLeft - geo.padRight;
  const plotH = geo.height - geo.padTop - geo.padBottom;
  const max = niceMax(Math.max(1, ...byCategory.map((r) => r.total)));
  const slot = plotW / Math.max(1, months.length);
  const barW = Math.min(64, slot * 0.62);

  // 0 件の月と欠測は別。欠測は quality パネルで示し、ここでは 0 として描かない。
  const usedCategories = categoryIds.filter((id) =>
    byCategory.some((row) => (row.counts[id] ?? 0) > 0),
  );

  const parts: string[] = [];
  parts.push(gridAndAxis(geo, plotW, plotH, max, months, slot));

  byCategory.forEach((row, i) => {
    let cursor = 0;
    const x = geo.padLeft + slot * i + (slot - barW) / 2;
    for (const id of usedCategories) {
      const count = row.counts[id] ?? 0;
      if (count === 0) continue;
      const h = (count / max) * plotH;
      const y = geo.padTop + plotH - (cursor / max) * plotH - h;
      parts.push(
        `<rect class="seg" x="${r(x)}" y="${r(y)}" width="${r(barW)}" height="${r(h)}" fill="${
          CATEGORY_COLORS[id] ?? '#999'
        }"><title>${escapeXml(row.month)} ${escapeXml(categoryLabels[id] ?? id)}: ${count} 件</title></rect>`,
      );
      cursor += count;
    }
    if (row.total > 0) {
      const y = geo.padTop + plotH - (row.total / max) * plotH - 6;
      parts.push(
        `<text class="bar-total" x="${r(x + barW / 2)}" y="${r(y)}" text-anchor="middle">${row.total}</text>`,
      );
    }
  });

  const legend = usedCategories
    .map((id) => ({ color: CATEGORY_COLORS[id] ?? '#999', label: categoryLabels[id] ?? id }))
    .concat(usedCategories.length === 0 ? [{ color: '#c3c7cc', label: 'データなし' }] : []);

  return wrapSvg(
    geo,
    parts.join('\n'),
    '公開月（UTC）別・内容別の新規 advisory 件数（積み上げ棒）',
    legend,
  );
}

/** 月別 × 重大度のヒートマップ。重大度は内容分類とは別軸で保持する。 */
export function severityHeatmapSvg(result: AggregateResult): string {
  const { months, bySeverity } = result;
  const cellW = Math.max(48, Math.min(96, 760 / Math.max(1, months.length)));
  const cellH = 34;
  const padLeft = 96;
  const padTop = 30;
  const width = padLeft + cellW * months.length + 20;
  const height = padTop + cellH * SEVERITIES.length + 36;
  const max = Math.max(1, ...bySeverity.flatMap((row) => SEVERITIES.map((s) => row.counts[s])));

  const parts: string[] = [];
  months.forEach((month, i) => {
    parts.push(
      `<text class="axis" x="${r(padLeft + cellW * i + cellW / 2)}" y="${padTop - 10}" text-anchor="middle">${escapeXml(
        month.slice(2),
      )}</text>`,
    );
  });

  SEVERITIES.forEach((severity, rowIdx) => {
    const y = padTop + cellH * rowIdx;
    parts.push(
      `<text class="axis" x="${padLeft - 10}" y="${y + cellH / 2 + 4}" text-anchor="end">${escapeXml(
        severity,
      )}</text>`,
    );
    months.forEach((month, colIdx) => {
      const count = bySeverity[colIdx]?.counts[severity] ?? 0;
      const intensity = count === 0 ? 0 : 0.15 + 0.85 * (count / max);
      const x = padLeft + cellW * colIdx;
      parts.push(
        `<rect class="cell" x="${r(x + 1)}" y="${y + 1}" width="${r(cellW - 2)}" height="${cellH - 2}" rx="3" ` +
          `fill="${SEVERITY_COLORS[severity]}" fill-opacity="${r(intensity)}">` +
          `<title>${escapeXml(month)} ${escapeXml(severity)}: ${count} 件</title></rect>`,
      );
      if (count > 0) {
        parts.push(
          `<text class="cell-value" x="${r(x + cellW / 2)}" y="${y + cellH / 2 + 4}" text-anchor="middle" ` +
            `fill="${intensity > 0.6 ? '#fff' : '#1e2227'}">${count}</text>`,
        );
      }
    });
  });

  return (
    `<svg viewBox="0 0 ${r(width)} ${height}" role="img" aria-label="月別×重大度のヒートマップ" class="chart">` +
    styleBlock() +
    parts.join('\n') +
    '</svg>'
  );
}

/** 監視対象の Issue 作成月別の折れ線。欠測は線をつながない。 */
export function issueLineSvg(result: AggregateResult, geo = { ...DEFAULT_GEOMETRY, height: 300 }): string {
  const { months, issuesCreated, issuesOpenAtMonthEnd } = result;
  const plotW = geo.width - geo.padLeft - geo.padRight;
  const plotH = geo.height - geo.padTop - geo.padBottom;
  const max = niceMax(
    Math.max(1, ...issuesCreated.map((r0) => r0.total), ...issuesOpenAtMonthEnd.map((r0) => r0.count)),
  );
  const slot = plotW / Math.max(1, months.length);

  const parts: string[] = [gridAndAxis(geo, plotW, plotH, max, months, slot)];

  const x = (i: number) => geo.padLeft + slot * i + slot / 2;
  const y = (v: number) => geo.padTop + plotH - (v / max) * plotH;

  const createdPoints = issuesCreated.map((row, i) => `${r(x(i))},${r(y(row.total))}`).join(' ');
  const openPoints = issuesOpenAtMonthEnd.map((row, i) => `${r(x(i))},${r(y(row.count))}`).join(' ');

  parts.push(`<polyline class="line" points="${openPoints}" stroke="#8a8f98" stroke-dasharray="5 4" fill="none"/>`);
  parts.push(`<polyline class="line" points="${createdPoints}" stroke="#3f7d9e" fill="none"/>`);

  issuesCreated.forEach((row, i) => {
    parts.push(
      `<circle class="dot" cx="${r(x(i))}" cy="${r(y(row.total))}" r="4" fill="#3f7d9e">` +
        `<title>${escapeXml(row.month)} 新規バグ Issue: ${row.total} 件（confirmed ${row.counts.confirmed ?? 0}）</title></circle>`,
    );
    const open = issuesOpenAtMonthEnd[i]?.count ?? 0;
    parts.push(
      `<circle class="dot" cx="${r(x(i))}" cy="${r(y(open))}" r="3.5" fill="#8a8f98">` +
        `<title>${escapeXml(row.month)} 月末未解決: ${open} 件</title></circle>`,
    );
  });

  return wrapSvg(geo, parts.join('\n'), '監視対象の bug Issue：作成月別と月末未解決', [
    { color: '#3f7d9e', label: '新規（作成月）' },
    { color: '#8a8f98', label: '月末未解決' },
  ]);
}

/** 不具合の状態内訳（reported / confirmed / duplicate / invalid）。 */
export function bugStateBarSvg(result: AggregateResult, geo = { ...DEFAULT_GEOMETRY, height: 280 }): string {
  const { months, issuesCreated } = result;
  const plotW = geo.width - geo.padLeft - geo.padRight;
  const plotH = geo.height - geo.padTop - geo.padBottom;
  const max = niceMax(Math.max(1, ...issuesCreated.map((r0) => r0.total)));
  const slot = plotW / Math.max(1, months.length);
  const barW = Math.min(56, slot * 0.6);
  const states = ['confirmed', 'reported', 'duplicate', 'invalid'];

  const parts: string[] = [gridAndAxis(geo, plotW, plotH, max, months, slot)];

  issuesCreated.forEach((row, i) => {
    let cursor = 0;
    const x = geo.padLeft + slot * i + (slot - barW) / 2;
    for (const state of states) {
      const count = row.counts[state] ?? 0;
      if (count === 0) continue;
      const h = (count / max) * plotH;
      const yPos = geo.padTop + plotH - (cursor / max) * plotH - h;
      parts.push(
        `<rect class="seg" x="${r(x)}" y="${r(yPos)}" width="${r(barW)}" height="${r(h)}" fill="${
          BUG_STATE_COLORS[state] ?? '#999'
        }"><title>${escapeXml(row.month)} ${escapeXml(state)}: ${count} 件</title></rect>`,
      );
      cursor += count;
    }
  });

  return wrapSvg(
    geo,
    parts.join('\n'),
    'bug Issue の状態内訳（作成月別）',
    states.map((s) => ({ color: BUG_STATE_COLORS[s] ?? '#999', label: s })),
  );
}

// --- 共通部品 ---------------------------------------------------------------

function gridAndAxis(
  geo: ChartGeometry,
  plotW: number,
  plotH: number,
  max: number,
  months: string[],
  slot: number,
): string {
  const parts: string[] = [];
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const value = (max / ticks) * i;
    const y = geo.padTop + plotH - (value / max) * plotH;
    parts.push(
      `<line class="grid" x1="${geo.padLeft}" y1="${r(y)}" x2="${r(geo.padLeft + plotW)}" y2="${r(y)}"/>`,
    );
    parts.push(
      `<text class="axis" x="${geo.padLeft - 10}" y="${r(y + 4)}" text-anchor="end">${formatTick(value)}</text>`,
    );
  }
  months.forEach((month, i) => {
    parts.push(
      `<text class="axis" x="${r(geo.padLeft + slot * i + slot / 2)}" y="${
        geo.padTop + plotH + 20
      }" text-anchor="middle">${escapeXml(month)}</text>`,
    );
  });
  return parts.join('\n');
}

function wrapSvg(
  geo: ChartGeometry,
  body: string,
  ariaLabel: string,
  legend: { color: string; label: string }[],
): string {
  const legendY = geo.height - 14;
  let x = geo.padLeft;
  const legendParts: string[] = [];
  for (const item of legend) {
    legendParts.push(
      `<rect x="${r(x)}" y="${legendY - 9}" width="10" height="10" rx="2" fill="${item.color}"/>` +
        `<text class="legend" x="${r(x + 15)}" y="${legendY}">${escapeXml(item.label)}</text>`,
    );
    x += 26 + item.label.length * 9;
  }
  return (
    `<svg viewBox="0 0 ${geo.width} ${geo.height}" role="img" aria-label="${escapeXml(ariaLabel)}" class="chart">` +
    styleBlock() +
    body +
    legendParts.join('\n') +
    '</svg>'
  );
}

function styleBlock(): string {
  return (
    '<style>' +
    '.grid{stroke:var(--grid);stroke-width:1}' +
    '.axis{font-size:11px;fill:var(--muted)}' +
    '.legend{font-size:11px;fill:var(--fg)}' +
    '.bar-total{font-size:11px;fill:var(--muted)}' +
    '.cell-value{font-size:11px}' +
    '.line{stroke-width:2;stroke-linejoin:round}' +
    '.seg{stroke:var(--bg);stroke-width:1}' +
    '</style>'
  );
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function r(value: number): number {
  return Math.round(value * 100) / 100;
}
