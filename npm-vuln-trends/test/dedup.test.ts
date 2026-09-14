import { describe, expect, test } from 'bun:test';
import { mergeAdvisories } from '../src/domain/dedup.ts';
import type { NormalizedAdvisory } from '../src/domain/types.ts';

function advisory(overrides: Partial<NormalizedAdvisory> = {}): NormalizedAdvisory {
  return {
    ghsa_id: 'GHSA-aaaa-bbbb-cccc',
    cve_id: null,
    summary: 'sample',
    severity: 'high',
    cvss_score: null,
    review_state: 'reviewed',
    published_at: '2026-01-10T00:00:00Z',
    modified_at: '2026-01-10T00:00:00Z',
    withdrawn_at: null,
    origin: 'github',
    html_url: null,
    aliases: ['GHSA-aaaa-bbbb-cccc'],
    cwes: ['CWE-79'],
    packages: [
      { package_name: 'pkg-a', ecosystem: 'npm', vulnerable_range: '< 1.0.0', patched_version: '1.0.0' },
    ],
    ...overrides,
  };
}

describe('同じ脆弱性を水増ししない', () => {
  test('GitHub と OSV に同じ GHSA があっても合計は 1', () => {
    const merged = mergeAdvisories([
      advisory({ origin: 'github' }),
      advisory({ origin: 'osv', html_url: 'https://osv.dev/vulnerability/GHSA-aaaa-bbbb-cccc' }),
    ]);
    expect(merged).toHaveLength(1);
  });

  test('CVE の alias 経由でも同一と判定する', () => {
    const merged = mergeAdvisories([
      advisory({ ghsa_id: 'GHSA-1', cve_id: 'CVE-2026-0001', aliases: ['GHSA-1', 'CVE-2026-0001'] }),
      advisory({ ghsa_id: 'GHSA-1-osv', origin: 'osv', aliases: ['GHSA-1-osv', 'CVE-2026-0001'] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.aliases).toContain('CVE-2026-0001');
  });

  test('1 advisory が複数パッケージに影響しても全体件数は 1、影響先は統合される', () => {
    const merged = mergeAdvisories([
      advisory(),
      advisory({
        packages: [
          { package_name: 'pkg-b', ecosystem: 'npm', vulnerable_range: '< 2.0.0', patched_version: '2.0.0' },
        ],
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.packages.map((p) => p.package_name).sort()).toEqual(['pkg-a', 'pkg-b']);
  });

  test('翌月に更新されても公開月は動かず、modified だけ進む', () => {
    const merged = mergeAdvisories([
      advisory({ published_at: '2026-01-10T00:00:00Z', modified_at: '2026-01-10T00:00:00Z' }),
      advisory({ published_at: '2026-01-10T00:00:00Z', modified_at: '2026-02-05T00:00:00Z' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.published_at).toBe('2026-01-10T00:00:00Z');
    expect(merged[0]!.modified_at).toBe('2026-02-05T00:00:00Z');
  });

  test('GitHub を主台帳とし、OSV 由来の値で上書きしない', () => {
    const merged = mergeAdvisories([
      advisory({ origin: 'osv', severity: 'low', summary: 'osv 側' }),
      advisory({ origin: 'github', severity: 'critical', summary: 'github 側' }),
    ]);
    expect(merged[0]!.severity).toBe('critical');
    expect(merged[0]!.summary).toBe('github 側');
  });

  test('別々の脆弱性は統合しない', () => {
    const merged = mergeAdvisories([
      advisory({ ghsa_id: 'GHSA-1', aliases: ['GHSA-1'] }),
      advisory({ ghsa_id: 'GHSA-2', aliases: ['GHSA-2'] }),
    ]);
    expect(merged).toHaveLength(2);
  });

  test('撤回の時刻は最新を採る', () => {
    const merged = mergeAdvisories([
      advisory({ withdrawn_at: null }),
      advisory({ withdrawn_at: '2026-03-01T00:00:00Z' }),
    ]);
    expect(merged[0]!.withdrawn_at).toBe('2026-03-01T00:00:00Z');
  });
});
