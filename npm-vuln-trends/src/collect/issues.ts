import type { Database } from 'bun:sqlite';
import { getJson, parseNextLink } from './http.ts';
import { getCursor, saveRaw, setCoverage, setCursor, upsertIssue } from '../db/index.ts';
import { nowIso, overlapStart, toMonth } from '../domain/time.ts';
import type { NormalizedIssue, Registry } from '../domain/types.ts';
import type { AppConfig } from '../config.ts';

export const SOURCE = 'github_issues';

interface GhIssue {
  number: number;
  title: string;
  state: string;
  state_reason: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  pull_request?: unknown;
  labels: (string | { name?: string })[];
}

/** 取得時に bug ラベルで絞らない。全状態で取り込み、判定は集計時に行う。 */
export function normalizeIssue(raw: GhIssue, repository: string, packageName: string): NormalizedIssue {
  return {
    repository,
    number: raw.number,
    package_name: packageName,
    title: raw.title ?? '',
    state: raw.state === 'closed' ? 'closed' : 'open',
    state_reason: raw.state_reason,
    is_pull_request: raw.pull_request !== undefined && raw.pull_request !== null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    closed_at: raw.closed_at,
    labels: (raw.labels ?? [])
      .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
      .filter((l) => l !== ''),
    html_url: raw.html_url ?? null,
  };
}

export interface IssueCollectResult {
  repositories: number;
  pages: number;
  items: number;
  failed: { repository: string; error: string }[];
}

/**
 * state=all と since で取得し、PR を除外する（保存はするが is_pull_request で印を付ける）。
 * 取得できなかった tracker は coverage に 'missing' を残し、0 件と区別する。
 */
export async function collectIssues(
  db: Database,
  cfg: AppConfig,
  registry: Registry,
  runId: string,
  opts: { perPage?: number; maxPages?: number } = {},
): Promise<IssueCollectResult> {
  const result: IssueCollectResult = { repositories: 0, pages: 0, items: 0, failed: [] };

  for (const pkg of registry.packages) {
    const scope = pkg.repository;
    const cursor = getCursor(db, SOURCE, scope);
    const startedAt = nowIso();
    const since = cursor ? overlapStart(cursor, cfg.overlapHours) : `${pkg.since}T00:00:00Z`;

    const params = new URLSearchParams({
      state: 'all',
      since,
      per_page: String(opts.perPage ?? 100),
      sort: 'updated',
      direction: 'asc',
    });
    let url: string | null = `https://api.github.com/repos/${pkg.repository}/issues?${params.toString()}`;
    const batch: NormalizedIssue[] = [];
    let pages = 0;

    try {
      while (url) {
        const { body, headers } = await getJson<GhIssue[]>(url, {
          token: cfg.githubToken,
          userAgent: cfg.userAgent,
        });
        pages += 1;
        for (const raw of body) {
          saveRaw(db, {
            source: SOURCE,
            sourceKey: `${pkg.repository}#${raw.number}`,
            url: raw.html_url ?? url,
            runId,
            payload: raw,
          });
          batch.push(normalizeIssue(raw, pkg.repository, pkg.name));
        }
        url = parseNextLink(headers.get('link'));
        if (opts.maxPages && pages >= opts.maxPages) break;
      }
    } catch (err) {
      // 取得不能な tracker は未収集として残し、前回のカーソルを維持する。
      const message = err instanceof Error ? err.message : String(err);
      result.failed.push({ repository: pkg.repository, error: message });
      setCoverage(db, SOURCE, pkg.name, toMonth(nowIso()), 'missing', message);
      continue;
    }

    const tx = db.transaction(() => {
      for (const issue of batch) upsertIssue(db, issue, { registry });
      setCursor(db, SOURCE, scope, startedAt, runId);
      setCoverage(db, SOURCE, pkg.name, toMonth(nowIso()), 'collected');
    });
    tx();

    result.repositories += 1;
    result.pages += pages;
    result.items += batch.length;
  }

  return result;
}
