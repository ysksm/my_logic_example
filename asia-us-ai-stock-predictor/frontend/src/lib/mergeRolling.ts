import type { RollingPoint } from "../api/types";

export interface MergedRollingPoint {
  date: string;
  [windowKey: string]: string | number | null;
}

/**
 * ローリング相関 ({"20": [{date, corr}], "60": [...], ...}) を
 * 日付をキーに 1 本のレコード列へマージする（複数系列の折れ線チャート用）。
 * 値のキーは "w20" のように window を接頭辞付きで持つ。
 */
export function mergeRolling(
  rolling: Record<string, RollingPoint[]>,
): MergedRollingPoint[] {
  const byDate = new Map<string, MergedRollingPoint>();
  const windows = Object.keys(rolling).sort((a, b) => Number(a) - Number(b));

  for (const w of windows) {
    for (const point of rolling[w] ?? []) {
      let rec = byDate.get(point.date);
      if (!rec) {
        rec = { date: point.date };
        byDate.set(point.date, rec);
      }
      rec[`w${w}`] =
        point.corr == null || Number.isNaN(point.corr) ? null : point.corr;
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
