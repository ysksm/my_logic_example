/**
 * 比率 (0.012 = +1.2%) をパーセント表記に変換する。null/NaN は "—"。
 */
export function formatPct(
  value: number | null | undefined,
  digits = 1,
  withSign = true,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value * 100;
  const sign = withSign && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/**
 * σスコアを表記する。null/NaN は "—"。
 */
export function formatSigma(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}σ`;
}

/**
 * 相関値などの小数を表記する。null/NaN は "—"。
 */
export function formatCorr(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}
