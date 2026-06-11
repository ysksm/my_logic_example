/** バックエンド (FastAPI) のレスポンス型定義 */

// ---- /api/watchlist ----

export interface Instrument {
  symbol: string;
  name: string;
  market: string;
  note: string;
  adr: string;
}

export interface Layer {
  id: string;
  name: string;
  leaders: Instrument[];
  targets: Instrument[];
}

export interface Params {
  sigma_window: number;
  sigma_threshold: number;
  rolling_windows: number[];
  lag_range: [number, number];
  beta_window: number;
  min_samples_for_signal: number;
  hit_rate_strong: number;
  hit_rate_moderate: number;
}

export interface Watchlist {
  layers: Layer[];
  fx: Layer[];
  benchmark: Instrument;
  params: Params;
}

// ---- /api/heatmap ----

export interface HeatmapCell {
  asia: string;
  asia_name: string;
  us: string;
  us_name: string;
  corr: number | null;
  n: number;
}

export interface HeatmapLayer {
  layer_id: string;
  layer_name: string;
  cells: HeatmapCell[];
}

export interface HeatmapResponse {
  window: number;
  lag: number;
  layers: HeatmapLayer[];
}

// ---- /api/pair/{asia}/{us}/lags ----

export interface RollingPoint {
  date: string;
  corr: number | null;
}

export interface LagsResponse {
  asia: string;
  us: string;
  n_obs: number;
  /** キーはラグ ("-3".."3")。NaN は null として扱う */
  by_lag: Record<string, number | null>;
  /** キーはローリング窓 ("20"/"60"/"120") */
  rolling: Record<string, RollingPoint[]>;
  stale: boolean;
}

// ---- /api/pair/{asia}/{us}/overlay ----

export interface OverlayPoint {
  date: string;
  asia_close: number | null;
  us_close: number | null;
}

export interface OverlayResponse {
  asia: string;
  us: string;
  stale: boolean;
  series: OverlayPoint[];
}

// ---- /api/pair/{asia}/{us}/backtest ----

export interface ConditionalStats {
  asia: string;
  us: string;
  direction: string;
  n_trigger_days: number;
  hit_rate: number | null;
  mean_us_return: number | null;
  mean_us_residual: number | null;
  mean_gap: number | null;
  mean_open_to_close: number | null;
  baseline_hit_rate: number | null;
  trigger_dates: string[];
}

export interface PricingInDetail {
  date: string;
  asia_return: number | null;
  sigma_score: number | null;
  us_total: number | null;
  us_gap: number | null;
  us_open_to_close: number | null;
}

export interface PricingIn {
  n: number;
  mean_directed_total: number | null;
  mean_directed_gap: number | null;
  mean_directed_open_to_close: number | null;
  median_gap_ratio: number | null;
  pct_positive_residual: number | null;
  detail: PricingInDetail[];
}

export interface BacktestResponse {
  stats: ConditionalStats;
  pricing_in: PricingIn;
  stale: boolean;
}

// ---- /api/signals/today ----

export type Strength = "strong" | "moderate" | "weak" | "none";

export interface SignalError {
  symbol: string;
  error: string;
}

export interface Signal {
  date: string;
  layer_id: string;
  layer_name: string;
  asia_symbol: string;
  asia_name: string;
  asia_return: number | null;
  asia_sigma: number | null;
  us_symbol: string;
  us_name: string;
  stats: ConditionalStats;
  premarket_move: number | null;
  priced_in_ratio: number | null;
  strength: Strength;
  rationale: string;
}

export interface SignalsResponse {
  as_of: string;
  summary: string;
  errors: SignalError[];
  signals: Signal[];
}
