import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { openDb, upsertAdvisory } from '../src/db/index.ts';
import { loadRegistry, loadTaxonomy } from '../src/config.ts';
import { aggregate } from '../src/aggregate/monthly.ts';
import { mergeAdvisories } from '../src/domain/dedup.ts';
import { demoAdvisories } from '../src/demo/fixtures.ts';
import { renderHtml } from '../src/report/html.ts';
import { categoryCsv, detailCsv, severityCsv } from '../src/report/csv.ts';
import { escapeXml, niceMax, stackedBarSvg } from '../src/report/svg.ts';
import { parseArgs, defaultRange } from '../src/index.ts';

const taxonomy = loadTaxonomy(resolve(import.meta.dir, '../config/taxonomy.json'));
const registry = loadRegistry(resolve(import.meta.dir, '../config/registry.json'));

function demoResult() {
  const db = openDb(':memory:');
  for (const item of mergeAdvisories(demoAdvisories())) {
    upsertAdvisory(db, item, {
      runId: 'test',
      taxonomy,
      registryVersion: registry.registry_version,
      observedAt: '2026-04-01T00:00:00Z',
    });
  }
  return aggregate(db, taxonomy, registry, { from: '2026-01', to: '2026-03' });
}

describe('SVG の生成', () => {
  test('積み上げ棒に月ごとのセグメントと合計が入る', () => {
    const svg = stackedBarSvg(demoResult());
    expect(svg).toStartWith('<svg');
    expect(svg).toContain('2026-01');
    expect(svg).toContain('2026-03');
    // 3 か月ぶんのカテゴリのセグメント（XSS・資源枯渇・未分類 × 3 か月 = 9）
    expect(svg.match(/<rect class="seg"/g)).toHaveLength(9);
  });

  test('XML の特殊文字を escape する', () => {
    expect(escapeXml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  test('目盛りの上限を切りのよい値に丸める', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(9)).toBe(10);
    expect(niceMax(23)).toBe(25);
  });
});

describe('HTML の生成', () => {
  test('必要な注記とパネルを含む', () => {
    const html = renderHtml(demoResult());
    expect(html).toStartWith('<!doctype html>');
    expect(html).toContain('主分類の合計 = 全体件数');
    expect(html).toContain('対象範囲');
    expect(html).toContain('取得基準日時');
    expect(html).toContain('分類版');
    expect(html).toContain('未分類率');
    // 脆弱性と不具合、自システムへの影響が別パネルになっている。
    expect(html).toContain('内容別の変化');
    expect(html).toContain('通常の不具合');
    expect(html).toContain('自システムへの影響');
    expect(html).toContain('npm audit の結果は未収集です');
  });

  test('観測時点を指定すると、その旨が表示される', () => {
    const db = openDb(':memory:');
    const result = aggregate(db, taxonomy, registry, {
      from: '2026-01',
      to: '2026-03',
      asOf: '2026-02-15T00:00:00Z',
    });
    expect(renderHtml(result)).toContain('observed_at ≤ 2026-02-15T00:00:00Z');
  });
});

describe('CSV の生成', () => {
  test('内容別 CSV の合計列が全体件数と一致する', () => {
    const result = demoResult();
    const lines = categoryCsv(result).trim().split('\n');
    expect(lines[0]).toStartWith('month,');
    expect(lines).toHaveLength(4); // ヘッダ + 3 か月
    const totals = lines.slice(1).map((line) => Number(line.split(',').at(-1)));
    expect(totals).toEqual([6, 9, 5]);
  });

  test('重大度 CSV の合計が内容別と一致する', () => {
    const result = demoResult();
    const totals = severityCsv(result)
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => Number(line.split(',').at(-1)));
    expect(totals).toEqual([6, 9, 5]);
  });

  test('明細 CSV は引用符を含む値を壊さない', () => {
    const result = demoResult();
    result.details[0]!.summary = 'a "quoted", value';
    expect(detailCsv(result)).toContain('"a ""quoted"", value"');
  });
});

describe('CLI の引数解釈', () => {
  test('--key value と真偽フラグを解釈する', () => {
    const args = parseArgs(['report', '--from', '2026-01', '--packages-only']);
    expect(args.command).toBe('report');
    expect(args.flags.from).toBe('2026-01');
    expect(args.flags['packages-only']).toBe(true);
  });

  test('既定の集計期間は直近 6 か月', () => {
    const range = defaultRange(new Date('2026-03-15T00:00:00Z'));
    expect(range).toEqual({ from: '2025-10', to: '2026-03' });
  });
});
