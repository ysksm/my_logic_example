import type { Database } from 'bun:sqlite';
import { saveRaw } from '../db/index.ts';
import { nowIso } from '../domain/time.ts';
import { normalizeSeverity } from './advisories.ts';

export const SOURCE = 'npm_audit';

/**
 * 自システムへの影響（npm audit）は「診断対象・実行時点ごとの結果」であり、
 * 公開報告数とは別指標。advisories とは合算しない。
 */
interface NpmAuditJson {
  vulnerabilities?: Record<
    string,
    {
      name?: string;
      severity?: string;
      via?: (string | { source?: number; url?: string; title?: string; severity?: string })[];
    }
  >;
  metadata?: { vulnerabilities?: Record<string, number> };
}

export function importAuditJson(
  db: Database,
  runId: string,
  target: string,
  payload: NpmAuditJson,
  executedAt = nowIso(),
): { snapshotId: string; findings: number } {
  const snapshotId = `${target}-${executedAt.replace(/[:-]/g, '')}`;
  const raw = saveRaw(db, {
    source: SOURCE,
    sourceKey: snapshotId,
    url: `npm-audit://${target}`,
    runId,
    payload,
  });

  const meta = payload.metadata?.vulnerabilities ?? {};
  const vulns = Object.values(payload.vulnerabilities ?? {});

  db.query(
    `INSERT OR REPLACE INTO audit_snapshots
       (snapshot_id, target, executed_at, tool, total, critical, high, moderate, low, raw_id)
     VALUES (?, ?, ?, 'npm audit', ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshotId,
    target,
    executedAt,
    meta.total ?? vulns.length,
    meta.critical ?? 0,
    meta.high ?? 0,
    meta.moderate ?? 0,
    meta.low ?? 0,
    raw.id,
  );

  const stmt = db.query(
    `INSERT OR IGNORE INTO audit_findings (snapshot_id, package_name, severity, ghsa_id, via)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let findings = 0;
  for (const vuln of vulns) {
    const name = vuln.name ?? 'unknown';
    const severity = normalizeSeverity(vuln.severity);
    const viaEntries = (vuln.via ?? []).filter((v) => typeof v === 'object') as {
      url?: string;
      title?: string;
    }[];
    if (viaEntries.length === 0) {
      stmt.run(snapshotId, name, severity, '', null);
      findings += 1;
      continue;
    }
    for (const via of viaEntries) {
      const ghsa = /GHSA-[0-9a-z-]+/i.exec(via.url ?? '')?.[0] ?? '';
      stmt.run(snapshotId, name, severity, ghsa, via.title ?? null);
      findings += 1;
    }
  }

  return { snapshotId, findings };
}
