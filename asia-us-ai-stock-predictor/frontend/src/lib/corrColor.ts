/**
 * 相関値 (-1..1, null可) をヒートマップ用の HSL 色に変換する。
 * - null / NaN: グレー
 * - 正の相関: 赤系 (強いほど濃い)
 * - 負の相関: 青系 (強いほど濃い)
 */
export function corrColor(corr: number | null | undefined): string {
  if (corr == null || Number.isNaN(corr)) {
    return "hsl(0, 0%, 88%)";
  }
  const clamped = Math.max(-1, Math.min(1, corr));
  const magnitude = Math.abs(clamped);
  const hue = clamped >= 0 ? 4 : 215;
  // |corr|=0 → ほぼ白 (96%), |corr|=1 → 濃色 (45%)
  const lightness = 96 - magnitude * 51;
  return `hsl(${hue}, 78%, ${Math.round(lightness)}%)`;
}

/** セル背景色に対して読みやすい文字色を返す（濃いセルは白文字） */
export function corrTextColor(corr: number | null | undefined): string {
  if (corr == null || Number.isNaN(corr)) return "#555";
  return Math.abs(corr) > 0.55 ? "#fff" : "#222";
}
