import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent, loadConfig, loadRegistry, loadTaxonomy } from './config.ts';
import type { AppConfig } from './config.ts';
import {
  finishRun,
  openDb,
  recordRuleVersion,
  setCoverage,
  startRun,
  upsertAdvisory,
  upsertIssue,
} from './db/index.ts';
import { collectAdvisories } from './collect/advisories.ts';
import { collectOsvForPackages } from './collect/osv.ts';
import { collectIssues } from './collect/issues.ts';
import { importAuditJson } from './collect/audit.ts';
import { aggregate } from './aggregate/monthly.ts';
import type { AggregateOptions, AggregateResult } from './aggregate/monthly.ts';
import { renderHtml } from './report/html.ts';
import { categoryCsv, detailCsv, issuesCsv, packageCsv, severityCsv } from './report/csv.ts';
import { demoAdvisories, demoAuditPayload, demoIssues } from './demo/fixtures.ts';
import { mergeAdvisories } from './domain/dedup.ts';
import { monthRange, nowIso, toMonth } from './domain/time.ts';

const USAGE = `npm-vuln-trends — npm ライブラリの不具合・脆弱性の時系列集計

使い方:
  bun run src/index.ts <command> [options]

コマンド:
  collect            公式情報を収集して原本保存・正規化する
  aggregate          月次集計を標準出力に出す（JSON）
  report             集計結果から静的 HTML / SVG / CSV を生成する
  demo               説明用の架空データを投入して report まで実行する
  serve              生成済みの出力を HTTP で配信する
  audit-import       npm audit --json の結果を取り込む

共通オプション:
  --from YYYY-MM     集計開始月（既定: 6 か月前）
  --to YYYY-MM       集計終了月（既定: 当月）
  --as-of ISO8601    その時点までに収集した版で再集計する（既定: 現在の知識）
  --packages-only    監視対象パッケージに絞る（既定: npm 全体）
  --db PATH          SQLite の保存先
  --out DIR          出力先ディレクトリ

collect のオプション:
  --source all|advisories|osv|issues   収集する情報源（既定: all）
  --max-pages N                        1 情報源あたりの最大ページ数（試験用）

audit-import のオプション:
  --file PATH        npm audit --json の出力
  --target NAME      診断対象の名前

環境変数:
  GITHUB_TOKEN       GitHub API のトークン（レート制限の緩和に使う）
  NVT_DB / NVT_OUT   既定の保存先・出力先
`;

interface Args {
  command: string;
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function str(flags: Args['flags'], key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

/** 既定は直近 6 か月（当月を含む）。月境界は UTC。 */
export function defaultRange(now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 7);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return { from: start.toISOString().slice(0, 7), to };
}

function aggregateOptions(flags: Args['flags']): AggregateOptions {
  const fallback = defaultRange();
  return {
    from: str(flags, 'from') ?? fallback.from,
    to: str(flags, 'to') ?? fallback.to,
    asOf: str(flags, 'as-of') ?? null,
    packagesOnly: flags['packages-only'] === true,
  };
}

function configFrom(flags: Args['flags']): AppConfig {
  const overrides: Partial<AppConfig> = {};
  const db = str(flags, 'db');
  const out = str(flags, 'out');
  if (db) overrides.dbPath = db;
  if (out) overrides.outDir = out;
  return loadConfig(overrides);
}

function setup(cfg: AppConfig) {
  const db = openDb(cfg.dbPath);
  const registry = loadRegistry(cfg.registryPath);
  const taxonomy = loadTaxonomy(cfg.taxonomyPath);
  recordRuleVersion(db, 'registry', registry.registry_version, registry);
  recordRuleVersion(db, 'taxonomy', taxonomy.taxonomy_version, taxonomy);
  return { db, registry, taxonomy };
}

// --- commands ---------------------------------------------------------------

async function cmdCollect(flags: Args['flags']): Promise<void> {
  const cfg = configFrom(flags);
  const { db, registry, taxonomy } = setup(cfg);
  const source = str(flags, 'source') ?? 'all';
  const maxPagesRaw = str(flags, 'max-pages');
  const maxPages = maxPagesRaw ? Number(maxPagesRaw) : undefined;

  if (!cfg.githubToken) {
    console.warn('警告: GITHUB_TOKEN が未設定です。未認証のレート制限で失敗しやすくなります。');
  }

  if (source === 'all' || source === 'advisories') {
    const runId = startRun(db, 'github_advisories');
    try {
      const res = await collectAdvisories(db, cfg, taxonomy, registry, runId, { maxPages });
      finishRun(db, runId, 'success', { pages: res.pages, items: res.items });
      setCoverage(db, 'github_advisories', 'npm-all', toMonth(nowIso()), 'collected');
      console.log(
        `advisories: ${res.items} 件を正規化（新規 ${res.newItems}）／ ${res.pages} ページ。カーソル=${res.cursorAt}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finishRun(db, runId, 'failed', { error: message });
      // 失敗時はカーソルを更新しないため、次回は同じ起点から取り直す。
      setCoverage(db, 'github_advisories', 'npm-all', toMonth(nowIso()), 'missing', message);
      console.error(`advisories: 失敗（カーソルは維持）: ${message}`);
    }
  }

  if (source === 'all' || source === 'osv') {
    const runId = startRun(db, 'osv');
    try {
      const res = await collectOsvForPackages(db, cfg, taxonomy, registry, runId);
      finishRun(db, runId, 'success', { items: res.items });
      console.log(`osv: ${res.queried} パッケージを照合、${res.items} 件（新規 ${res.newItems}）`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finishRun(db, runId, 'failed', { error: message });
      console.error(`osv: 失敗: ${message}`);
    }
  }

  if (source === 'all' || source === 'issues') {
    const runId = startRun(db, 'github_issues');
    const res = await collectIssues(db, cfg, registry, runId, { maxPages });
    const status = res.failed.length > 0 && res.repositories === 0 ? 'failed' : 'success';
    finishRun(db, runId, status, {
      pages: res.pages,
      items: res.items,
      error: res.failed.map((f) => `${f.repository}: ${f.error}`).join('; ') || undefined,
    });
    console.log(`issues: ${res.repositories} リポジトリ / ${res.items} 件（失敗 ${res.failed.length}）`);
    for (const failure of res.failed) console.error(`  未収集: ${failure.repository} — ${failure.error}`);
  }

  db.close();
}

function cmdAggregate(flags: Args['flags']): AggregateResult {
  const cfg = configFrom(flags);
  const { db, registry, taxonomy } = setup(cfg);
  const result = aggregate(db, taxonomy, registry, aggregateOptions(flags));
  db.close();
  return result;
}

function writeReport(cfg: AppConfig, result: AggregateResult): void {
  mkdirSync(cfg.outDir, { recursive: true });
  const files: [string, string][] = [
    ['index.html', renderHtml(result)],
    ['category.csv', categoryCsv(result)],
    ['severity.csv', severityCsv(result)],
    ['package.csv', packageCsv(result)],
    ['issues.csv', issuesCsv(result)],
    ['detail.csv', detailCsv(result)],
    ['summary.json', JSON.stringify(result, null, 2)],
  ];
  for (const [name, content] of files) writeFileSync(join(cfg.outDir, name), content, 'utf8');
  console.log(`出力: ${cfg.outDir}（${files.map(([n]) => n).join(', ')}）`);
}

function cmdReport(flags: Args['flags']): void {
  const cfg = configFrom(flags);
  writeReport(cfg, cmdAggregate(flags));
}

/**
 * 説明用の架空データを投入する。実データの集計結果ではない。
 * 収集を経由せずに、正規化以降（統合・分類・集計・可視化）を通して確認できる。
 */
function cmdDemo(flags: Args['flags']): void {
  const cfg = configFrom(flags);
  const { db, registry, taxonomy } = setup(cfg);
  const runId = startRun(db, 'github_advisories');

  const merged = mergeAdvisories(demoAdvisories());
  const tx = db.transaction(() => {
    for (const advisory of merged) {
      upsertAdvisory(db, advisory, {
        runId,
        taxonomy,
        registryVersion: registry.registry_version,
        observedAt: '2026-04-01T00:00:00Z',
      });
    }
    for (const issue of demoIssues()) {
      upsertIssue(db, issue, { registry, observedAt: '2026-04-01T00:00:00Z' });
    }
  });
  tx();
  finishRun(db, runId, 'success', { items: merged.length });

  const issueRun = startRun(db, 'github_issues');
  finishRun(db, issueRun, 'success', { items: demoIssues().length });

  const auditRun = startRun(db, 'npm_audit');
  importAuditJson(db, auditRun, 'demo-project', demoAuditPayload() as never, '2026-03-31T00:00:00Z');
  finishRun(db, auditRun, 'success', { items: 2 });

  for (const month of monthRange('2026-01', '2026-03')) {
    setCoverage(db, 'github_advisories', 'npm-all', month, 'collected');
    for (const pkg of registry.packages) setCoverage(db, 'github_issues', pkg.name, month, 'collected');
  }
  // 欠測と 0 件を区別できることを示す例。
  setCoverage(db, 'github_issues', 'webpack', '2026-02', 'missing', '取得不能な期間（説明用）');

  const options: AggregateOptions = {
    from: str(flags, 'from') ?? '2026-01',
    to: str(flags, 'to') ?? '2026-03',
    asOf: str(flags, 'as-of') ?? null,
    packagesOnly: flags['packages-only'] === true,
  };
  const result = aggregate(db, taxonomy, registry, options);
  db.close();

  writeReport(cfg, result);
  console.log('注意: 説明用の架空データです。実データの集計結果ではありません。');
  for (const row of result.byCategory) {
    const parts = result.categoryIds
      .filter((id) => (row.counts[id] ?? 0) > 0)
      .map((id) => `${result.categoryLabels[id]}=${row.counts[id]}`);
    console.log(`  ${row.month}: 合計 ${row.total}（${parts.join(', ')}）`);
  }
}

function cmdAuditImport(flags: Args['flags']): void {
  const cfg = configFrom(flags);
  const { db } = setup(cfg);
  const file = str(flags, 'file');
  const target = str(flags, 'target') ?? 'default';
  if (!file) throw new Error('--file に npm audit --json の出力を指定してください。');

  const runId = startRun(db, 'npm_audit');
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const res = importAuditJson(db, runId, target, payload);
  finishRun(db, runId, 'success', { items: res.findings });
  db.close();
  console.log(`npm audit: ${target} の結果を取り込みました（${res.findings} 件 / ${res.snapshotId}）`);
}

function cmdServe(flags: Args['flags']): void {
  const cfg = configFrom(flags);
  const port = Number(str(flags, 'port') ?? 8787);
  const server = Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      // 出力ディレクトリの外へ出さない。
      if (name.includes('..') || name.startsWith('/')) return new Response('不正なパス', { status: 400 });
      const file = Bun.file(join(cfg.outDir, name));
      if (!(await file.exists())) return new Response('見つかりません', { status: 404 });
      return new Response(file);
    },
  });
  console.log(`配信中: http://localhost:${server.port}/（出力元: ${cfg.outDir}）`);
}

// --- entry ------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'collect':
      await cmdCollect(flags);
      return 0;
    case 'aggregate':
      console.log(JSON.stringify(cmdAggregate(flags), null, 2));
      return 0;
    case 'report':
      cmdReport(flags);
      return 0;
    case 'demo':
      cmdDemo(flags);
      return 0;
    case 'audit-import':
      cmdAuditImport(flags);
      return 0;
    case 'serve':
      cmdServe(flags);
      return 0;
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(`不明なコマンド: ${command}\n`);
      console.log(USAGE);
      return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

export { hashContent };
