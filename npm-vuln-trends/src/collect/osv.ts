import type { Database } from 'bun:sqlite';
import { saveRaw, upsertAdvisory } from '../db/index.ts';
import { normalizeCwe } from '../domain/taxonomy.ts';
import { normalizeSeverity } from './advisories.ts';
import { mergeAdvisories } from '../domain/dedup.ts';
import type { NormalizedAdvisory, Registry, Taxonomy } from '../domain/types.ts';
import type { AppConfig } from '../config.ts';

export const SOURCE = 'osv';

export interface OsvVuln {
  id: string;
  aliases?: string[];
  related?: string[];
  summary?: string;
  published?: string;
  modified?: string;
  withdrawn?: string;
  database_specific?: { severity?: string; cwe_ids?: string[] };
  affected?: {
    package?: { ecosystem?: string; name?: string };
    ranges?: { events?: { introduced?: string; fixed?: string }[] }[];
  }[];
}

/**
 * OSV は alias・影響範囲の照合に使う。GitHub と同じ報告を二重に数えないよう、
 * 明示 alias（aliases）だけを同一性の根拠にする。related は使わない。
 */
export function normalizeOsv(raw: OsvVuln): NormalizedAdvisory | null {
  const aliases = new Set<string>([raw.id, ...(raw.aliases ?? [])]);
  const ghsaId = [...aliases].find((a) => a.startsWith('GHSA-')) ?? raw.id;
  const cveId = [...aliases].find((a) => a.startsWith('CVE-')) ?? null;

  const packages = (raw.affected ?? [])
    .filter((a) => a.package?.name)
    .map((a) => ({
      package_name: a.package!.name!,
      ecosystem: (a.package!.ecosystem ?? 'npm').toLowerCase(),
      vulnerable_range: rangeText(a.ranges),
      patched_version: firstFixed(a.ranges),
    }))
    .filter((p) => p.ecosystem === 'npm');

  if (packages.length === 0) return null;

  return {
    ghsa_id: ghsaId,
    cve_id: cveId,
    summary: raw.summary ?? '',
    severity: normalizeSeverity(raw.database_specific?.severity),
    cvss_score: null,
    review_state: 'reviewed',
    published_at: raw.published ?? null,
    modified_at: raw.modified ?? null,
    withdrawn_at: raw.withdrawn ?? null,
    origin: 'osv',
    html_url: `https://osv.dev/vulnerability/${raw.id}`,
    aliases: [...aliases].sort(),
    cwes: (raw.database_specific?.cwe_ids ?? [])
      .map(normalizeCwe)
      .filter((c): c is string => c !== null),
    packages,
  };
}

function rangeText(ranges: { events?: { introduced?: string; fixed?: string }[] }[] | undefined): string | null {
  if (!ranges?.length) return null;
  const parts: string[] = [];
  for (const range of ranges) {
    for (const event of range.events ?? []) {
      if (event.introduced) parts.push(`>= ${event.introduced}`);
      if (event.fixed) parts.push(`< ${event.fixed}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function firstFixed(
  ranges: { events?: { introduced?: string; fixed?: string }[] }[] | undefined,
): string | null {
  for (const range of ranges ?? []) {
    for (const event of range.events ?? []) {
      if (event.fixed) return event.fixed;
    }
  }
  return null;
}

/**
 * 監視対象パッケージだけ OSV に問い合わせ、alias と影響範囲を補う。
 * 既存の GHSA と alias が一致すれば加算されず、統合されるだけになる。
 */
export async function collectOsvForPackages(
  db: Database,
  cfg: AppConfig,
  taxonomy: Taxonomy,
  registry: Registry,
  runId: string,
): Promise<{ items: number; newItems: number; queried: number }> {
  const collected: NormalizedAdvisory[] = [];
  let queried = 0;

  for (const pkg of registry.packages) {
    const res = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': cfg.userAgent },
      body: JSON.stringify({ package: { ecosystem: 'npm', name: pkg.name } }),
    });
    if (!res.ok) throw new Error(`OSV 取得失敗 ${res.status}: ${pkg.name}`);
    queried += 1;

    const body = (await res.json()) as { vulns?: OsvVuln[] };
    for (const vuln of body.vulns ?? []) {
      saveRaw(db, {
        source: SOURCE,
        sourceKey: vuln.id,
        url: `https://osv.dev/vulnerability/${vuln.id}`,
        runId,
        payload: vuln,
      });
      const normalized = normalizeOsv(vuln);
      if (normalized) collected.push(normalized);
    }
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
  });
  tx();

  return { items: merged.length, newItems, queried };
}
