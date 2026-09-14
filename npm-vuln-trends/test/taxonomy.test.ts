import { describe, expect, test } from 'bun:test';
import { classify, normalizeCwe, orderedCategories } from '../src/domain/taxonomy.ts';
import { loadTaxonomy } from '../src/config.ts';
import { resolve } from 'node:path';

const taxonomy = loadTaxonomy(resolve(import.meta.dir, '../config/taxonomy.json'));

describe('CWE の正規化', () => {
  test('表記ゆれを CWE-nn に揃える', () => {
    expect(normalizeCwe('CWE-79')).toBe('CWE-79');
    expect(normalizeCwe('cwe_79')).toBe('CWE-79');
    expect(normalizeCwe(' 79 ')).toBe('CWE-79');
  });

  test('対応できない文字列は null', () => {
    expect(normalizeCwe('')).toBeNull();
    expect(normalizeCwe('NVD-CWE-noinfo')).toBeNull();
  });
});

describe('内容別カテゴリへの対応', () => {
  test('代表的な CWE が想定のカテゴリに入る', () => {
    expect(classify(['CWE-79'], taxonomy)).toBe('xss');
    expect(classify(['CWE-78'], taxonomy)).toBe('exec');
    expect(classify(['CWE-1321'], taxonomy)).toBe('proto');
    expect(classify(['CWE-1333'], taxonomy)).toBe('resource');
    expect(classify(['CWE-918'], taxonomy)).toBe('ssrf');
    expect(classify(['CWE-862'], taxonomy)).toBe('authz');
  });

  test('CWE が無ければ未分類', () => {
    expect(classify([], taxonomy)).toBe('unclassified');
  });

  test('対応表に無い CWE は「その他」（未分類と区別する）', () => {
    expect(classify(['CWE-200'], taxonomy)).toBe('other');
  });

  test('複数 CWE でも主分類は 1 つ、priority の高い方を採る', () => {
    // 積み上げ図では 1 件を 1 主分類へ計上するため、必ず 1 つに決まる必要がある。
    expect(classify(['CWE-79', 'CWE-78'], taxonomy)).toBe('exec');
    expect(classify(['CWE-1333', 'CWE-79'], taxonomy)).toBe('xss');
  });

  test('カテゴリの表示順は priority 昇順', () => {
    const ordered = orderedCategories(taxonomy).map((c) => c.id);
    expect(ordered[0]).toBe('exec');
    expect(ordered.at(-1)).toBe('unclassified');
  });
});
