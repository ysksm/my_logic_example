import type { Database } from 'bun:sqlite';
import { getJson, parseNextLink } from './http.ts';
import { saveRaw, setCursor, getCursor, upsertAdvisory } from '../db/index.ts';
import { normalizeCwe } from '../domain/taxonomy.ts';
import { nowIso, overlapStart } from '../domain/time.ts';
import { mergeAdvisories } from '../domain/dedup.ts';
import type { NormalizedAdvisory, Registry, Severity, Taxonomy } from '../domain/types.ts';
import type { AppConfig } from '../config.ts';

export const SOURCE = 'github_advisories';

interface GhAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: string;
  html_url: string;
  published_at: string | null;
  updated_at: string | null;
  withdrawn_at: string | null;
  type?: string;
  cvss?: { score: number | null } | null;
  cwes?: { cwe_id: string }[] | null;
  identifiers?: { type: string; value: string }[] | null;
  vulnerabilities?:
    | {
        package: { ecosystem: string; name: string } | null;
        vulnerable_version_range: string | null;
        first_patched_version: string | null;
      }[]
    | null;
}

/** GitHub-reviewed を npm の主系列とする。未審査・マルウェアは別系列として type で区別する。 */
export function normalizeGhAdvisory(raw: GhAdvisory): NormalizedAdvisory {
  const aliases = new Set<string>([raw.ghsa_id]);
  if (raw.cve_id) aliases.add(raw.cve_id);
  // 明示 alias のみ。related は同一性の根拠にしない。
  for (const id of raw.identifiers ?? []) {
    if (id.type === 'GHSA' || id.type === 'CVE') aliases.add(id.value);
  }

  return {
    ghsa_id: raw.ghsa_id,
    cve_id: raw.cve_id,
    summary: raw.summary ?? '',
    severity: normalizeSeverity(raw.severity),
    cvss_score: raw.cvss?.score ?? null,
    review_state:
      raw.type === 'malware' ? 'malware' : raw.type === 'unreviewed' ? 'unreviewed' : 'reviewed',
    published_at: raw.published_at,
    modified_at: raw.updated_at,
    withdrawn_at: raw.withdrawn_at,
    origin: 'github',
    html_url: raw.html_url ?? null,
    aliases: [...aliases].sort(),
    cwes: (raw.cwes ?? [])
      .map((c) => normalizeCwe(c.cwe_id))
      .filter((c): c is string => c !== null),
    packages: (raw.vulnerabilities ?? [])
      .filter((v) => v.package !== null)
      .map((v) => ({
        package_name: v.package!.name,
        ecosystem: v.package!.ecosystem,
        vulnerable_range: v.vulnerable_version_range,
        patched_version: v.first_patched_version,
      })),
  };
}

export function normalizeSeverity(value: string | null | undefined): Severity {
  switch ((value ?? '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'moderate':
    case 'medium':
      return 'moderate';
    case 'low':
      return 'low';
    default:
      return 'unknown';
  }
}

export interface CollectResult {
  pages: number;
  items: number;
  newItems: number;
  cursorAt: string;
}

/**
 * 差分取得は公開日ではなく変更（modified）を追う。
 * 初回は全ページ、以降は前回カーソル - 重複窓 を起点に再取得し、ID と内容ハッシュで一意化する。
 * 全ページ成功後にだけカーソルを更新する。
 */
export async function collectAdvisories(
  db: Database,
  cfg: AppConfig,
  taxonomy: Taxonomy,
  registry: Registry,
  runId: string,
  opts: { scope?: string; perPage?: number; maxPages?: number } = {},
): Promise<CollectResult> {
  const scope = opts.scope ?? 'npm-all';
  const cursor = getCursor(db, SOURCE, scope);
  const startedAt = nowIso();

  const params = new URLSearchParams({
    ecosystem: 'npm',
    type: 'reviewed',
    per_page: String(opts.perPage ?? 100),
    sort: 'updated',
    direction: 'asc',
  });
  if (cursor) params.set('modified', `>${overlapStart(cursor, cfg.overlapHours)}`);

  let url: string | null = `https://api.github.com/advisories?${params.toString()}`;
  const collected: NormalizedAdvisory[] = [];
  let pages = 0;

  while (url) {
    const { body, headers } = await getJson<GhAdvisory[]>(url, {
      token: cfg.githubToken,
      userAgent: cfg.userAgent,
    });
    pages += 1;
    for (const raw of body) {
      saveRaw(db, {
        source: SOURCE,
        sourceKey: raw.ghsa_id,
        url: raw.html_url ?? url,
        runId,
        payload: raw,
      });
      collected.push(normalizeGhAdvisory(raw));
    }
    url = parseNextLink(headers.get('link'));
    if (opts.maxPages && pages >= opts.maxPages) break;
  }

  const merged = mergeAdvisories(collected);
  let newItems = 0;
  const tx = db.transaction(() => {
    for (const advisory of merged) {
      const { isNew } = upsertAdvisory(db, advisory, {
        runId,
        taxonomy,
        registryVersion: registry.registry_version,
      });
      if (isNew) newItems += 1;
    }
    // 全ページ成功後にだけ保存位置を更新する。
    setCursor(db, SOURCE, scope, startedAt, runId);
  });
  tx();

  return { pages, items: merged.length, newItems, cursorAt: startedAt };
}
