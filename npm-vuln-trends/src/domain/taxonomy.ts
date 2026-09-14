import type { Category, Taxonomy } from './types.ts';

export const UNCLASSIFIED = 'unclassified';
export const OTHER = 'other';

/**
 * CWE から主分類を 1 つ選ぶ。
 * 積み上げ図では 1 件を 1 主分類へ割り当てるため、priority の小さい（＝影響の大きい）
 * カテゴリを優先する。CWE が無い／対応表に無い場合は unclassified / other に落とす。
 * 全 CWE は advisory_cwes に残り、明細で参照できる。
 */
export function classify(cwes: string[], taxonomy: Taxonomy): string {
  const normalized = cwes.map(normalizeCwe).filter((c): c is string => c !== null);
  if (normalized.length === 0) return UNCLASSIFIED;

  let best: Category | null = null;
  for (const category of taxonomy.categories) {
    if (category.cwes.length === 0) continue;
    if (!normalized.some((c) => category.cwes.includes(c))) continue;
    if (best === null || category.priority < best.priority) best = category;
  }
  if (best) return best.id;

  // CWE はあるが対応表に無い → 「その他」。対応表の欠損は unclassified 率で監視する。
  return OTHER;
}

/** "CWE-79" / "79" / "cwe-79" を "CWE-79" に揃える。 */
export function normalizeCwe(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const match = /^(?:cwe[-_ ]?)?(\d+)$/i.exec(trimmed);
  if (!match) return null;
  return `CWE-${match[1]}`;
}

export function categoryLabel(taxonomy: Taxonomy, id: string): string {
  return taxonomy.categories.find((c) => c.id === id)?.label ?? id;
}

/** 表示順（priority 昇順）。 */
export function orderedCategories(taxonomy: Taxonomy): Category[] {
  return [...taxonomy.categories].sort((a, b) => a.priority - b.priority);
}
