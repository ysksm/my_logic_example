import type {
  BacktestResponse,
  HeatmapResponse,
  LagsResponse,
  OverlayResponse,
  SignalsResponse,
  Watchlist,
} from "./types";

/**
 * JSON を取得する。バックエンドが NaN をそのまま出力するケースがあるため
 * (Python json.dumps の NaN リテラル)、テキストとして受けてから null に置換する。
 */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`APIエラー (HTTP ${res.status}) ${url} ${detail.slice(0, 200)}`);
  }
  const text = await res.text();
  const sanitized = text.replace(/\bNaN\b|\b-?Infinity\b/g, "null");
  return JSON.parse(sanitized) as T;
}

export const api = {
  watchlist: (): Promise<Watchlist> => getJson("/api/watchlist"),

  heatmap: (window: number, lag: number): Promise<HeatmapResponse> =>
    getJson(`/api/heatmap?window=${window}&lag=${lag}`),

  pairLags: (asia: string, us: string): Promise<LagsResponse> =>
    getJson(`/api/pair/${encodeURIComponent(asia)}/${encodeURIComponent(us)}/lags`),

  pairOverlay: (asia: string, us: string, days = 250): Promise<OverlayResponse> =>
    getJson(
      `/api/pair/${encodeURIComponent(asia)}/${encodeURIComponent(us)}/overlay?days=${days}`,
    ),

  pairBacktest: (asia: string, us: string, direction = "all"): Promise<BacktestResponse> =>
    getJson(
      `/api/pair/${encodeURIComponent(asia)}/${encodeURIComponent(us)}/backtest?direction=${direction}`,
    ),

  signalsToday: (refresh = false): Promise<SignalsResponse> =>
    getJson(`/api/signals/today?refresh=${refresh}&premarket=true`),
};
