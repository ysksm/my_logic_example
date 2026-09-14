import type { NormalizedAdvisory, NormalizedIssue } from '../domain/types.ts';

/**
 * 説明用の架空データ。npm の実測値ではありません。
 *
 * スライドの例に合わせて、公開月別の内容別件数を
 *   XSS：3 / 5 / 2、資源枯渇：2 / 3 / 2、未分類：1 / 1 / 1（合計 6 / 9 / 5）
 * になるように作る。あわせて、次の不変条件を目で確認できる例を混ぜてある。
 *   - 翌月の更新では新規が増えない（modified_at だけ動く）
 *   - 1 advisory が 2 パッケージに影響しても全体件数は 1
 *   - 撤回された advisory は新規件数に加算されない
 *   - GitHub と OSV に同じ GHSA があっても合計は 1
 */

const PLAN: { month: string; xss: number; resource: number; unclassified: number }[] = [
  { month: '2026-01', xss: 3, resource: 2, unclassified: 1 },
  { month: '2026-02', xss: 5, resource: 3, unclassified: 1 },
  { month: '2026-03', xss: 2, resource: 2, unclassified: 1 },
];

const PACKAGES = ['lodash', 'axios', 'express', 'webpack'];
const SEVERITY_CYCLE = ['high', 'moderate', 'critical', 'low', 'moderate'] as const;

export function demoAdvisories(): NormalizedAdvisory[] {
  const out: NormalizedAdvisory[] = [];
  let seq = 0;

  for (const row of PLAN) {
    const groups: { cwes: string[]; count: number }[] = [
      { cwes: ['CWE-79'], count: row.xss },
      { cwes: ['CWE-1333'], count: row.resource },
      { cwes: [], count: row.unclassified }, // CWE 欠損 → 未分類
    ];

    for (const group of groups) {
      for (let i = 0; i < group.count; i += 1) {
        seq += 1;
        const day = String(((seq * 3) % 26) + 1).padStart(2, '0');
        const ghsa = `GHSA-demo-${row.month.replace('-', '')}-${String(seq).padStart(3, '0')}`;
        const pkg = PACKAGES[seq % PACKAGES.length]!;
        out.push({
          ghsa_id: ghsa,
          cve_id: `CVE-2026-${String(1000 + seq).padStart(5, '0')}`,
          summary: describe(group.cwes, pkg),
          severity: SEVERITY_CYCLE[seq % SEVERITY_CYCLE.length]!,
          cvss_score: null,
          review_state: 'reviewed',
          published_at: `${row.month}-${day}T09:00:00Z`,
          modified_at: `${row.month}-${day}T09:00:00Z`,
          withdrawn_at: null,
          origin: 'github',
          html_url: `https://github.com/advisories/${ghsa}`,
          aliases: [ghsa, `CVE-2026-${String(1000 + seq).padStart(5, '0')}`],
          cwes: group.cwes,
          packages: [
            {
              package_name: pkg,
              ecosystem: 'npm',
              vulnerable_range: '< 1.2.3',
              patched_version: '1.2.3',
            },
          ],
        });
      }
    }
  }

  // 1 月の 1 件目を「翌月に更新」：新規は 0 のまま、modified_at だけ進む。
  const updated = out[0];
  if (updated) updated.modified_at = '2026-02-11T04:00:00Z';

  // 1 advisory が 2 パッケージに影響：全体件数は 1、パッケージ別は A・B に各 1。
  const multi = out[1];
  if (multi) {
    multi.packages.push({
      package_name: 'express',
      ecosystem: 'npm',
      vulnerable_range: '< 4.19.0',
      patched_version: '4.19.0',
    });
  }

  // GitHub と OSV に同じ GHSA：alias が一致するので合計は 1 のまま。
  const shared = out[2];
  if (shared) {
    out.push({
      ...shared,
      summary: `${shared.summary}（OSV 側の記述）`,
      origin: 'osv',
      html_url: `https://osv.dev/vulnerability/${shared.ghsa_id}`,
      cwes: [...shared.cwes],
      packages: shared.packages.map((p) => ({ ...p })),
      aliases: [...shared.aliases],
    });
  }

  // 撤回された advisory：新規件数には加算しない（品質パネルにだけ現れる）。
  out.push({
    ghsa_id: 'GHSA-demo-withdrawn-001',
    cve_id: null,
    summary: '撤回された報告（新規件数には加算しない）',
    severity: 'high',
    cvss_score: null,
    review_state: 'reviewed',
    published_at: '2026-02-14T00:00:00Z',
    modified_at: '2026-03-02T00:00:00Z',
    withdrawn_at: '2026-03-02T00:00:00Z',
    origin: 'github',
    html_url: 'https://github.com/advisories/GHSA-demo-withdrawn-001',
    aliases: ['GHSA-demo-withdrawn-001'],
    cwes: ['CWE-79'],
    packages: [
      { package_name: 'lodash', ecosystem: 'npm', vulnerable_range: '< 5.0.0', patched_version: null },
    ],
  });

  return out;
}

const ISSUE_PLAN: { month: string; reported: number; confirmed: number; duplicate: number; invalid: number }[] = [
  { month: '2026-01', reported: 7, confirmed: 4, duplicate: 2, invalid: 1 },
  { month: '2026-02', reported: 9, confirmed: 6, duplicate: 1, invalid: 2 },
  { month: '2026-03', reported: 5, confirmed: 3, duplicate: 2, invalid: 1 },
];

export function demoIssues(): NormalizedIssue[] {
  const out: NormalizedIssue[] = [];
  const repos: Record<string, string> = {
    lodash: 'lodash/lodash',
    axios: 'axios/axios',
    express: 'expressjs/express',
    webpack: 'webpack/webpack',
  };
  let number = 1000;

  for (const row of ISSUE_PLAN) {
    const states: [string, number, string[]][] = [
      ['reported', row.reported, ['bug']],
      ['confirmed', row.confirmed, ['bug', 'confirmed']],
      ['duplicate', row.duplicate, ['bug', 'duplicate']],
      ['invalid', row.invalid, ['bug', 'invalid']],
    ];

    for (const [state, count, labels] of states) {
      for (let i = 0; i < count; i += 1) {
        number += 1;
        const pkg = PACKAGES[number % PACKAGES.length]!;
        const day = String((number % 26) + 1).padStart(2, '0');
        // 一部は翌月以降にクローズ（月末未解決数に効く）。close ≠ 修正。
        const closes = state !== 'reported' || number % 3 === 0;
        const closedMonth = row.month === '2026-01' ? '2026-02' : row.month === '2026-02' ? '2026-03' : '2026-03';
        out.push({
          repository: repos[pkg]!,
          number,
          package_name: pkg,
          title: `${pkg}: 動作不正の報告 #${number}`,
          state: closes ? 'closed' : 'open',
          state_reason: state === 'invalid' ? 'not_planned' : closes ? 'completed' : null,
          is_pull_request: false,
          created_at: `${row.month}-${day}T12:00:00Z`,
          updated_at: `${closedMonth}-15T12:00:00Z`,
          closed_at: closes ? `${closedMonth}-15T12:00:00Z` : null,
          labels,
          html_url: `https://github.com/${repos[pkg]}/issues/${number}`,
        });
      }
    }
  }

  // PR は除外される（取り込みはするが集計には入らない）。
  number += 1;
  out.push({
    repository: 'axios/axios',
    number,
    package_name: 'axios',
    title: 'fix: PR は不具合件数に数えない',
    state: 'closed',
    state_reason: 'completed',
    is_pull_request: true,
    created_at: '2026-02-10T12:00:00Z',
    updated_at: '2026-02-12T12:00:00Z',
    closed_at: '2026-02-12T12:00:00Z',
    labels: ['bug'],
    html_url: `https://github.com/axios/axios/pull/${number}`,
  });

  // bug ラベルの無い Issue も取り込むが、バグ件数には入らない。
  number += 1;
  out.push({
    repository: 'webpack/webpack',
    number,
    package_name: 'webpack',
    title: '使い方の質問',
    state: 'open',
    state_reason: null,
    is_pull_request: false,
    created_at: '2026-03-05T12:00:00Z',
    updated_at: '2026-03-05T12:00:00Z',
    closed_at: null,
    labels: ['question'],
    html_url: `https://github.com/webpack/webpack/issues/${number}`,
  });

  return out;
}

export function demoAuditPayload(): unknown {
  return {
    vulnerabilities: {
      lodash: {
        name: 'lodash',
        severity: 'high',
        via: [{ url: 'https://github.com/advisories/GHSA-demo-202601-001', title: 'XSS in lodash' }],
      },
      axios: {
        name: 'axios',
        severity: 'moderate',
        via: [{ url: 'https://github.com/advisories/GHSA-demo-202602-007', title: 'ReDoS in axios' }],
      },
    },
    metadata: { vulnerabilities: { total: 2, critical: 0, high: 1, moderate: 1, low: 0 } },
  };
}

function describe(cwes: string[], pkg: string): string {
  if (cwes.includes('CWE-79')) return `${pkg} における XSS（説明用の架空データ）`;
  if (cwes.includes('CWE-1333')) return `${pkg} における ReDoS・リソース枯渇（説明用の架空データ）`;
  return `${pkg} における分類未対応の報告（説明用の架空データ）`;
}
