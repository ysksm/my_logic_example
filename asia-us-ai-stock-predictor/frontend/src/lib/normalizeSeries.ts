import type { OverlayPoint } from "../api/types";

export interface NormalizedPoint {
  date: string;
  /** アジア銘柄: 最初の非null終値 = 100 とした指数。欠損日は null（線を切る） */
  asia: number | null;
  /** 米国銘柄: 同上 */
  us: number | null;
}

/**
 * 重ね合わせチャート用の正規化。
 * 各系列について最初の非 null 値を 100 とする指数に変換する。
 * null（祝日ずれ等の欠損）はそのまま null で返し、チャート側で線を切る。
 */
export function normalizeSeries(series: OverlayPoint[]): NormalizedPoint[] {
  const firstAsia = series.find((p) => p.asia_close != null)?.asia_close ?? null;
  const firstUs = series.find((p) => p.us_close != null)?.us_close ?? null;

  return series.map((p) => ({
    date: p.date,
    asia:
      p.asia_close != null && firstAsia != null && firstAsia !== 0
        ? (p.asia_close / firstAsia) * 100
        : null,
    us:
      p.us_close != null && firstUs != null && firstUs !== 0
        ? (p.us_close / firstUs) * 100
        : null,
  }));
}
