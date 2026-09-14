import type { NormalizedAdvisory } from './types.ts';

/**
 * 同じ脆弱性を、更新やパッケージ数で水増ししない。
 *
 * - 明示 alias（GHSA / CVE）でのみ同一と判定する。related は根拠にしない。
 * - 同じ advisory を翌月に更新しても新規は 0（published_at は変えない）。
 * - 1 advisory が複数パッケージに影響しても全体件数は 1。
 */
export function mergeAdvisories(items: NormalizedAdvisory[]): NormalizedAdvisory[] {
  const byKey = new Map<string, NormalizedAdvisory>();
  const aliasToKey = new Map<string, string>();

  for (const item of items) {
    const keys = aliasKeys(item);
    let target: NormalizedAdvisory | undefined;
    let targetKey: string | undefined;

    for (const key of keys) {
      const existingKey = aliasToKey.get(key);
      if (existingKey !== undefined) {
        const candidate = byKey.get(existingKey);
        if (candidate) {
          target = candidate;
          targetKey = existingKey;
          break;
        }
      }
    }

    if (!target || targetKey === undefined) {
      const key = item.ghsa_id;
      byKey.set(key, cloneAdvisory(item));
      for (const alias of keys) aliasToKey.set(alias, key);
      continue;
    }

    mergeInto(target, item);
    for (const alias of aliasKeys(target)) aliasToKey.set(alias, targetKey);
  }

  return [...byKey.values()];
}

function aliasKeys(item: NormalizedAdvisory): string[] {
  const keys = new Set<string>();
  keys.add(item.ghsa_id);
  if (item.cve_id) keys.add(item.cve_id);
  for (const alias of item.aliases) if (alias) keys.add(alias);
  return [...keys];
}

function cloneAdvisory(item: NormalizedAdvisory): NormalizedAdvisory {
  return {
    ...item,
    aliases: [...new Set(aliasKeys(item))].sort(),
    cwes: [...new Set(item.cwes)],
    packages: item.packages.map((p) => ({ ...p })),
  };
}

/**
 * GitHub を主台帳にし、OSV は alias・影響範囲の照合に使う。
 * そのため github 由来の値を優先し、欠けている項目だけを OSV で補う。
 */
function mergeInto(target: NormalizedAdvisory, incoming: NormalizedAdvisory): void {
  const incomingWins = target.origin !== 'github' && incoming.origin === 'github';

  if (incomingWins) {
    target.origin = incoming.origin;
    target.severity = incoming.severity;
    target.review_state = incoming.review_state;
    target.summary = incoming.summary || target.summary;
    target.html_url = incoming.html_url ?? target.html_url;
  }

  target.cve_id ??= incoming.cve_id;
  target.cvss_score ??= incoming.cvss_score;
  target.html_url ??= incoming.html_url;
  if (target.summary === '') target.summary = incoming.summary;
  if (target.severity === 'unknown') target.severity = incoming.severity;

  // 公開月は最も古い published_at を採る（更新で月がずれないようにする）。
  target.published_at = earliest(target.published_at, incoming.published_at);
  // 更新・撤回は最新を採る。
  target.modified_at = latest(target.modified_at, incoming.modified_at);
  target.withdrawn_at = latest(target.withdrawn_at, incoming.withdrawn_at);

  target.aliases = [...new Set([...target.aliases, ...aliasKeys(incoming)])].sort();
  target.cwes = [...new Set([...target.cwes, ...incoming.cwes])];

  for (const pkg of incoming.packages) {
    const existing = target.packages.find(
      (p) => p.package_name === pkg.package_name && p.ecosystem === pkg.ecosystem,
    );
    if (!existing) {
      target.packages.push({ ...pkg });
      continue;
    }
    existing.vulnerable_range ??= pkg.vulnerable_range;
    existing.patched_version ??= pkg.patched_version;
  }
}

function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}
