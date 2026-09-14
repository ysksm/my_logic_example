import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashContent } from '../config.ts';
import { nowIso } from '../domain/time.ts';
import type {
  CoverageStatus,
  NormalizedAdvisory,
  NormalizedIssue,
  Registry,
  Taxonomy,
} from '../domain/types.ts';
import { classify } from '../domain/taxonomy.ts';
import { bugState, isBug, labelRulesFor } from '../domain/issueState.ts';

const SCHEMA_PATH = resolve(import.meta.dir, 'schema.sql');

export function openDb(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

// --- 実行履歴 -------------------------------------------------------------

export function startRun(db: Database, source: string): string {
  const runId = `${source}-${nowIso().replace(/[:-]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
  db.query(
    `INSERT INTO fetch_runs (run_id, source, started_at, status) VALUES (?, ?, ?, 'running')`,
  ).run(runId, source, nowIso());
  return runId;
}

export function finishRun(
  db: Database,
  runId: string,
  status: 'success' | 'failed',
  stats: { pages?: number; items?: number; error?: string } = {},
): void {
  db.query(
    `UPDATE fetch_runs SET finished_at = ?, status = ?, pages = ?, items = ?, error = ? WHERE run_id = ?`,
  ).run(nowIso(), status, stats.pages ?? 0, stats.items ?? 0, stats.error ?? null, runId);
}

/** 全ページ成功後にだけ保存位置を更新する。失敗時は前回結果を維持する。 */
export function setCursor(
  db: Database,
  source: string,
  scope: string,
  cursorAt: string,
  runId: string,
): void {
  db.query(
    `INSERT INTO source_cursors (source, scope, cursor_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source, scope) DO UPDATE SET
       cursor_at = excluded.cursor_at, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(source, scope, cursorAt, nowIso(), runId);
}

export function getCursor(db: Database, source: string, scope: string): string | null {
  const row = db
    .query<{ cursor_at: string }, [string, string]>(
      `SELECT cursor_at FROM source_cursors WHERE source = ? AND scope = ?`,
    )
    .get(source, scope);
  return row?.cursor_at ?? null;
}

// --- 原本保存 -------------------------------------------------------------

/** 原本に URL・取得日時・ハッシュ・実行 ID を付けて保存する。内容が同じなら加算しない。 */
export function saveRaw(
  db: Database,
  input: { source: string; sourceKey: string; url: string; runId: string; payload: unknown },
): { id: number | null; isNew: boolean; hash: string } {
  const payload = JSON.stringify(input.payload);
  const hash = hashContent(payload);
  const existing = db
    .query<{ id: number }, [string, string, string]>(
      `SELECT id FROM raw_documents WHERE source = ? AND source_key = ? AND content_hash = ?`,
    )
    .get(input.source, input.sourceKey, hash);
  if (existing) return { id: existing.id, isNew: false, hash };

  db.query(
    `INSERT INTO raw_documents (source, source_key, url, fetched_at, content_hash, run_id, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.source, input.sourceKey, input.url, nowIso(), hash, input.runId, payload);
  const row = db.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get();
  return { id: row?.id ?? null, isNew: true, hash };
}

// --- advisory -------------------------------------------------------------

export function upsertAdvisory(
  db: Database,
  advisory: NormalizedAdvisory,
  ctx: { runId: string; taxonomy: Taxonomy; registryVersion: string; observedAt?: string },
): { isNew: boolean } {
  const observedAt = ctx.observedAt ?? nowIso();
  const categoryId = classify(advisory.cwes, ctx.taxonomy);
  const existing = db
    .query<{ ghsa_id: string; first_seen_at: string }, [string]>(
      `SELECT ghsa_id, first_seen_at FROM advisories WHERE ghsa_id = ?`,
    )
    .get(advisory.ghsa_id);

  db.query(
    `INSERT INTO advisories (
       ghsa_id, cve_id, summary, severity, cvss_score, review_state,
       published_at, modified_at, withdrawn_at, first_seen_at, last_seen_at,
       origin, html_url, taxonomy_version, category_id, registry_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (ghsa_id) DO UPDATE SET
       cve_id = COALESCE(excluded.cve_id, advisories.cve_id),
       summary = excluded.summary,
       severity = excluded.severity,
       cvss_score = COALESCE(excluded.cvss_score, advisories.cvss_score),
       review_state = excluded.review_state,
       published_at = COALESCE(advisories.published_at, excluded.published_at),
       modified_at = excluded.modified_at,
       withdrawn_at = excluded.withdrawn_at,
       last_seen_at = excluded.last_seen_at,
       html_url = COALESCE(excluded.html_url, advisories.html_url),
       taxonomy_version = excluded.taxonomy_version,
       category_id = excluded.category_id,
       registry_version = excluded.registry_version`,
  ).run(
    advisory.ghsa_id,
    advisory.cve_id,
    advisory.summary,
    advisory.severity,
    advisory.cvss_score,
    advisory.review_state,
    advisory.published_at,
    advisory.modified_at,
    advisory.withdrawn_at,
    existing?.first_seen_at ?? observedAt,
    observedAt,
    advisory.origin,
    advisory.html_url,
    ctx.taxonomy.taxonomy_version,
    categoryId,
    ctx.registryVersion,
  );

  const aliasStmt = db.query(
    `INSERT OR IGNORE INTO advisory_aliases (alias, ghsa_id) VALUES (?, ?)`,
  );
  for (const alias of advisory.aliases) aliasStmt.run(alias, advisory.ghsa_id);

  db.query(`DELETE FROM advisory_cwes WHERE ghsa_id = ?`).run(advisory.ghsa_id);
  const cweStmt = db.query(
    `INSERT OR IGNORE INTO advisory_cwes (ghsa_id, cwe_id, ordinal) VALUES (?, ?, ?)`,
  );
  advisory.cwes.forEach((cwe, i) => cweStmt.run(advisory.ghsa_id, cwe, i));

  const pkgStmt = db.query(
    `INSERT INTO advisory_packages (ghsa_id, package_name, ecosystem, vulnerable_range, patched_version)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (ghsa_id, package_name, ecosystem) DO UPDATE SET
       vulnerable_range = excluded.vulnerable_range, patched_version = excluded.patched_version`,
  );
  for (const pkg of advisory.packages) {
    pkgStmt.run(
      advisory.ghsa_id,
      pkg.package_name,
      pkg.ecosystem,
      pkg.vulnerable_range,
      pkg.patched_version,
    );
  }

  // 改訂履歴（内容が変わったときだけ 1 行増える）
  db.query(
    `INSERT OR IGNORE INTO advisory_revisions (ghsa_id, observed_at, modified_at, withdrawn_at, severity, content_hash, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    advisory.ghsa_id,
    observedAt,
    advisory.modified_at,
    advisory.withdrawn_at,
    advisory.severity,
    hashContent(advisory),
    ctx.runId,
  );

  return { isNew: existing === null };
}

// --- issue ----------------------------------------------------------------

export function upsertIssue(
  db: Database,
  issue: NormalizedIssue,
  ctx: { registry: Registry; observedAt?: string },
): void {
  const observedAt = ctx.observedAt ?? nowIso();
  const pkg = ctx.registry.packages.find((p) => p.name === issue.package_name);
  const rules = pkg
    ? labelRulesFor(ctx.registry, pkg)
    : {
        bug: ctx.registry.defaults.bug_labels,
        confirmed: ctx.registry.defaults.confirmed_labels,
        duplicate: ctx.registry.defaults.duplicate_labels,
        invalid: ctx.registry.defaults.invalid_labels,
      };

  const existing = db
    .query<{ first_seen_at: string; state: string }, [string, number]>(
      `SELECT first_seen_at, state FROM issues WHERE repository = ? AND number = ?`,
    )
    .get(issue.repository, issue.number);

  db.query(
    `INSERT INTO issues (
       repository, number, package_name, title, state, state_reason, is_pull_request,
       created_at, updated_at, closed_at, labels, bug_state, is_bug,
       first_seen_at, last_seen_at, html_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (repository, number) DO UPDATE SET
       title = excluded.title,
       state = excluded.state,
       state_reason = excluded.state_reason,
       updated_at = excluded.updated_at,
       closed_at = excluded.closed_at,
       labels = excluded.labels,
       bug_state = excluded.bug_state,
       is_bug = excluded.is_bug,
       last_seen_at = excluded.last_seen_at,
       html_url = COALESCE(excluded.html_url, issues.html_url)`,
  ).run(
    issue.repository,
    issue.number,
    issue.package_name,
    issue.title,
    issue.state,
    issue.state_reason,
    issue.is_pull_request ? 1 : 0,
    issue.created_at,
    issue.updated_at,
    issue.closed_at,
    JSON.stringify(issue.labels),
    bugState(issue, rules),
    isBug(issue, rules) ? 1 : 0,
    existing?.first_seen_at ?? observedAt,
    observedAt,
    issue.html_url,
  );

  const eventStmt = db.query(
    `INSERT OR IGNORE INTO issue_events (repository, number, event, detail, occurred_at, observed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  eventStmt.run(issue.repository, issue.number, 'opened', null, issue.created_at, observedAt);
  if (issue.closed_at) {
    eventStmt.run(
      issue.repository,
      issue.number,
      'closed',
      issue.state_reason,
      issue.closed_at,
      observedAt,
    );
  }
  // 一度 closed を観測した後に open へ戻っていれば再オープン。
  if (existing?.state === 'closed' && issue.state === 'open') {
    eventStmt.run(issue.repository, issue.number, 'reopened', null, issue.updated_at, observedAt);
  }
}

// --- 収集可否 -------------------------------------------------------------

export function setCoverage(
  db: Database,
  source: string,
  scope: string,
  month: string,
  status: CoverageStatus,
  note?: string,
): void {
  db.query(
    `INSERT INTO coverage (source, scope, month, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, scope, month) DO UPDATE SET
       status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
  ).run(source, scope, month, status, note ?? null, nowIso());
}

export function recordRuleVersion(
  db: Database,
  kind: 'registry' | 'taxonomy',
  version: string,
  content: unknown,
): void {
  db.query(
    `INSERT OR IGNORE INTO rule_versions (kind, version, applied_at, content_hash) VALUES (?, ?, ?, ?)`,
  ).run(kind, version, nowIso(), hashContent(content));
}
