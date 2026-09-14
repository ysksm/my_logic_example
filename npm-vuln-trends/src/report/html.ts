import type { AggregateResult } from '../aggregate/monthly.ts';
import { SEVERITIES } from '../domain/types.ts';
import {
  bugStateBarSvg,
  escapeXml,
  issueLineSvg,
  severityHeatmapSvg,
  stackedBarSvg,
} from './svg.ts';

const SOURCE_LABELS: Record<string, string> = {
  github_advisories: 'GitHub Advisory Database',
  osv: 'OSV',
  github_issues: 'GitHub Issues',
  npm_audit: 'npm audit',
};

export function renderHtml(result: AggregateResult): string {
  const q = result.quality;
  const range = `${result.months[0] ?? '-'} 〜 ${result.months.at(-1) ?? '-'}`;
  const asOfLabel = q.asOf
    ? `保存済みの観測時点（observed_at ≤ ${escapeXml(q.asOf)}）`
    : '現在の知識で過去を再集計';

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>npm ライブラリの不具合・脆弱性の時系列集計</title>
<style>${css()}</style>
</head>
<body>
<header class="page-head">
  <h1>npm ライブラリの不具合・脆弱性の時系列集計</h1>
  <p class="lede">公式情報を収集し、内容別の変化を追う。脆弱性と通常の不具合は別々に集計する。</p>
  <dl class="meta">
    <div><dt>対象範囲</dt><dd>${escapeXml(range)}（UTC）／ ${
      result.options.packagesOnly ? '監視対象パッケージのみ' : 'npm 全体の公開脆弱性'
    }</dd></div>
    <div><dt>集計基準</dt><dd>${escapeXml(asOfLabel)}</dd></div>
    <div><dt>取得基準日時</dt><dd>${escapeXml(q.generatedAt)}</dd></div>
    <div><dt>分類版 / 台帳版</dt><dd>${escapeXml(q.taxonomyVersion)} / ${escapeXml(q.registryVersion)}</dd></div>
  </dl>
</header>

<main>
  <section class="panel">
    <h2>内容別の変化</h2>
    <p class="note">公開月（UTC）の新規 advisory。主分類の合計 = 全体件数。1 件は 1 主分類にだけ計上する（全 CWE は明細に残る）。</p>
    ${stackedBarSvg(result)}
    ${monthlyTable(result)}
  </section>

  <section class="panel">
    <h2>重大度（別軸）</h2>
    <p class="note">内容分類とは独立した軸。月別 × 重大度の件数。</p>
    ${severityHeatmapSvg(result)}
  </section>

  <section class="panel">
    <h2>通常の不具合（監視対象の Issue）</h2>
    <p class="note">PR は除外。bug ラベルは取得時に絞らず現在値で判定するため、ラベル削除も反映される。close は修正と同義ではない。</p>
    ${issueLineSvg(result)}
    ${bugStateBarSvg(result)}
  </section>

  <section class="panel">
    <h2>パッケージ別（全体件数とは別指標）</h2>
    <p class="note">1 advisory が複数パッケージに影響する場合、全体件数は 1、パッケージ別は各 1 として数える。合計は全体件数と一致しない。</p>
    ${packageTable(result)}
  </section>

  <section class="panel">
    <h2>自システムへの影響（npm audit）</h2>
    <p class="note">診断対象・実行時点ごとの結果。公開報告数とは別指標なので、上の件数とは合算しない。</p>
    ${auditTable(result)}
  </section>

  <section class="panel">
    <h2>品質</h2>
    ${qualityPanel(result)}
  </section>

  <section class="panel">
    <h2>明細</h2>
    <p class="note">ID・影響範囲・原典リンク。積み上げ棒の 1 セグメントはこの明細の行に対応する。</p>
    ${detailTable(result)}
  </section>

  <section class="panel">
    <h2>CSV</h2>
    <ul class="links">
      <li><a href="./category.csv">月次 × 内容別</a></li>
      <li><a href="./severity.csv">月次 × 重大度</a></li>
      <li><a href="./package.csv">パッケージ別</a></li>
      <li><a href="./issues.csv">不具合（Issue）</a></li>
      <li><a href="./detail.csv">明細</a></li>
      <li><a href="./summary.json">集計結果 (JSON)</a></li>
    </ul>
  </section>
</main>

<footer>
  <p>情報源：GitHub Global Advisory Database（GitHub-reviewed を主系列）· OSV（alias・影響範囲の照合）· GitHub Issues · npm audit · MITRE CWE。</p>
  <p>件数の増加は、対象追加や取り込み量の変化でも起こる。件数だけで品質の良し悪しは判断しない。</p>
</footer>
</body>
</html>
`;
}

function monthlyTable(result: AggregateResult): string {
  const used = result.categoryIds.filter((id) =>
    result.byCategory.some((row) => (row.counts[id] ?? 0) > 0),
  );
  if (used.length === 0) return '<p class="empty">対象期間に計上された advisory はありません。</p>';

  const head = ['月', ...used.map((id) => result.categoryLabels[id] ?? id), '合計'];
  const body = result.byCategory.map((row) => [
    row.month,
    ...used.map((id) => String(row.counts[id] ?? 0)),
    `<strong>${row.total}</strong>`,
  ]);
  return table(head, body, 'numeric');
}

function packageTable(result: AggregateResult): string {
  if (result.byPackage.length === 0) return '<p class="empty">該当するパッケージ別の件数はありません。</p>';
  const body = result.byPackage
    .slice(0, 40)
    .map((row) => [escapeXml(row.package_name), row.month, String(row.count)]);
  return table(['パッケージ', '公開月', '件数'], body, 'numeric');
}

function auditTable(result: AggregateResult): string {
  if (result.audit.length === 0) {
    return '<p class="empty">npm audit の結果は未収集です（0 件ではなく未収集）。</p>';
  }
  const body = result.audit.map((row) => [
    escapeXml(row.target),
    escapeXml(row.executed_at),
    String(row.total),
    String(row.critical),
    String(row.high),
    String(row.moderate),
    String(row.low),
  ]);
  return table(['診断対象', '実行時点', '合計', 'critical', 'high', 'moderate', 'low'], body, 'numeric');
}

function qualityPanel(result: AggregateResult): string {
  const q = result.quality;
  const cards = [
    { label: '監視対象パッケージ', value: String(q.targetPackages) },
    { label: '対象期間の advisory', value: String(q.advisoriesInRange) },
    { label: '未分類率', value: `${(q.unclassifiedRate * 100).toFixed(1)}%` },
    { label: 'その他率', value: `${(q.otherRate * 100).toFixed(1)}%` },
    { label: '撤回により除外', value: String(q.withdrawnExcluded) },
  ]
    .map(
      (card) =>
        `<div class="card"><span class="card-value">${escapeXml(card.value)}</span><span class="card-label">${escapeXml(
          card.label,
        )}</span></div>`,
    )
    .join('');

  const runs = Object.entries(q.lastSuccessAt)
    .map(([source, at]) => [
      escapeXml(SOURCE_LABELS[source] ?? source),
      at ? escapeXml(at) : '<span class="missing">未収集</span>',
    ]);

  const missing =
    q.missingCoverage.length === 0
      ? '<p class="note">欠測として記録された月はありません。</p>'
      : table(
          ['情報源', '対象', '月', '内容'],
          q.missingCoverage.map((m) => [
            escapeXml(SOURCE_LABELS[m.source] ?? m.source),
            escapeXml(m.scope),
            escapeXml(m.month),
            `<span class="missing">${escapeXml(m.note ?? '未収集')}</span>`,
          ]),
        );

  return `<div class="cards">${cards}</div>
    <h3>最終成功時刻</h3>
    ${table(['情報源', '最終成功'], runs)}
    <h3>欠測（0 件とは区別する）</h3>
    ${missing}`;
}

function detailTable(result: AggregateResult): string {
  if (result.details.length === 0) return '<p class="empty">明細はありません。</p>';
  const body = result.details.slice(0, 200).map((d) => [
    d.html_url
      ? `<a href="${escapeXml(d.html_url)}" rel="noreferrer noopener" target="_blank">${escapeXml(d.ghsa_id)}</a>`
      : escapeXml(d.ghsa_id),
    escapeXml(d.cve_id ?? '-'),
    escapeXml((d.published_at ?? '').slice(0, 10)),
    `<span class="sev sev-${escapeXml(d.severity)}">${escapeXml(d.severity)}</span>`,
    escapeXml(result.categoryLabels[d.category_id] ?? d.category_id),
    escapeXml(d.cwes || '-'),
    escapeXml(d.packages || '-'),
    escapeXml(d.summary),
  ]);
  const more =
    result.details.length > 200
      ? `<p class="note">先頭 200 件を表示（全 ${result.details.length} 件）。全件は CSV を参照。</p>`
      : '';
  return (
    table(
      ['ID', 'CVE', '公開日', '重大度', '主分類', 'CWE', 'パッケージ', '概要'],
      body,
      'detail',
    ) + more
  );
}

function table(head: string[], rows: string[][], variant = ''): string {
  return `<div class="table-wrap"><table class="${variant}">
<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>`;
}

function css(): string {
  return `
:root{
  --bg:#ffffff; --fg:#1e2227; --muted:#5f6672; --grid:#e4e7ec;
  --panel:#ffffff; --border:#e0e4ea; --accent:#3f7d9e;
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#14171b; --fg:#e6e9ed; --muted:#9aa2ad; --grid:#2b3037;
         --panel:#1a1e23; --border:#2b3037; }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font-family:"Hiragino Sans","Noto Sans JP",system-ui,-apple-system,"Segoe UI",sans-serif;
  line-height:1.65;font-size:15px}
.page-head{max-width:960px;margin:0 auto;padding:40px 20px 16px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:.01em}
.lede{margin:0 0 18px;color:var(--muted)}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px 20px;margin:0;
  padding:14px 16px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
.meta div{display:flex;flex-direction:column}
.meta dt{font-size:11px;color:var(--muted);letter-spacing:.04em}
.meta dd{margin:0;font-size:13px}
main{max-width:960px;margin:0 auto;padding:0 20px 40px}
.panel{margin:28px 0;padding:20px;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
h2{font-size:17px;margin:0 0 4px}
h3{font-size:14px;margin:20px 0 6px;color:var(--muted)}
.note{margin:0 0 14px;font-size:12.5px;color:var(--muted)}
.empty{margin:8px 0;font-size:13px;color:var(--muted)}
.chart{display:block;width:100%;height:auto;margin:8px 0 4px}
.table-wrap{overflow-x:auto;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 10px;border-bottom:1px solid var(--grid);text-align:left;white-space:nowrap}
th{font-weight:600;color:var(--muted);font-size:11.5px;letter-spacing:.03em}
table.numeric td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
table.detail{min-width:940px}
table.detail td:last-child{white-space:normal;width:30%;min-width:240px}
a{color:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:6px 0 4px}
.card{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid var(--border);border-radius:6px}
.card-value{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.card-label{font-size:11.5px;color:var(--muted)}
.missing{color:#c04a2b}
.sev{padding:1px 7px;border-radius:10px;font-size:11px;color:#fff}
.sev-critical{background:#8c1d2c}.sev-high{background:#c04a2b}
.sev-moderate{background:#a9812c}.sev-low{background:#5b93b8}
.sev-unknown{background:#8a8f98}
.links{margin:0;padding-left:18px;font-size:13.5px}
.links li{margin:3px 0}
footer{max-width:960px;margin:0 auto;padding:0 20px 48px;color:var(--muted);font-size:12px}
footer p{margin:4px 0}
@media (max-width:640px){
  th,td{padding:5px 7px;font-size:12px}
  .panel{padding:14px}
  h1{font-size:21px}
}
`;
}
