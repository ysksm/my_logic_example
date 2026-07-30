import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { useFetch } from "../api/useFetch";
import type { Watchlist } from "../api/types";
import { corrColor } from "../lib/corrColor";
import { formatCorr, formatPct, formatSigma } from "../lib/format";
import { mergeRolling } from "../lib/mergeRolling";
import { normalizeSeries } from "../lib/normalizeSeries";
import { ErrorBanner } from "./ErrorBanner";
import { Loading } from "./Loading";

/** recharts Tooltip 用: 数値以外（null等）は "—" を返す */
function tooltipNumber(value: unknown): string {
  return typeof value === "number" && !Number.isNaN(value) ? value.toFixed(1) : "—";
}

function tooltipCorr(value: unknown): string {
  return typeof value === "number" ? formatCorr(value) : "—";
}

interface PairOption {
  key: string;
  asia: string;
  asiaName: string;
  us: string;
  usName: string;
  layerName: string;
}

function buildPairOptions(watchlist: Watchlist): PairOption[] {
  const options: PairOption[] = [];
  for (const layer of watchlist.layers) {
    for (const leader of layer.leaders) {
      for (const target of layer.targets) {
        options.push({
          key: `${leader.symbol}|${target.symbol}`,
          asia: leader.symbol,
          asiaName: leader.name,
          us: target.symbol,
          usName: target.name,
          layerName: layer.name,
        });
      }
    }
  }
  return options;
}

const ROLLING_COLORS: Record<string, string> = {
  w20: "#90caf9",
  w60: "#42a5f5",
  w120: "#1565c0",
};

function PairDetail({ pair }: { pair: PairOption }) {
  const overlay = useFetch(() => api.pairOverlay(pair.asia, pair.us, 250), [pair.key]);
  const lags = useFetch(() => api.pairLags(pair.asia, pair.us), [pair.key]);
  const backtest = useFetch(() => api.pairBacktest(pair.asia, pair.us), [pair.key]);

  const normalized = useMemo(
    () => (overlay.data ? normalizeSeries(overlay.data.series) : []),
    [overlay.data],
  );

  const lagBars = useMemo(() => {
    if (!lags.data) return [];
    return Object.entries(lags.data.by_lag)
      .map(([lag, corr]) => ({
        lag: Number(lag),
        corr: corr == null || Number.isNaN(corr) ? null : corr,
      }))
      .sort((a, b) => a.lag - b.lag);
  }, [lags.data]);

  const rollingData = useMemo(
    () => (lags.data ? mergeRolling(lags.data.rolling) : []),
    [lags.data],
  );
  const rollingWindows = useMemo(
    () =>
      lags.data
        ? Object.keys(lags.data.rolling).sort((a, b) => Number(a) - Number(b))
        : [],
    [lags.data],
  );

  const stats = backtest.data?.stats;
  const pricing = backtest.data?.pricing_in;

  return (
    <div>
      {/* ---- 重ね合わせチャート ---- */}
      <section className="card">
        <h3>価格の重ね合わせ（期間初日 = 100 に正規化・同一軸）</h3>
        {overlay.error && <ErrorBanner message={overlay.error} />}
        {overlay.loading && <Loading />}
        {overlay.data && (
          <>
            {overlay.data.stale && (
              <p className="stale-note">注意: 価格データが古い可能性があります。</p>
            )}
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={normalized}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={40} />
                <YAxis domain={["auto", "auto"]} />
                <Tooltip formatter={tooltipNumber} />
                <Legend />
                <ReferenceLine y={100} stroke="#999" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="asia"
                  name={`${pair.asiaName} (${pair.asia})`}
                  stroke="#d32f2f"
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="us"
                  name={`${pair.usName} (${pair.us})`}
                  stroke="#1565c0"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </section>

      {/* ---- ラグプロファイル & ローリング相関 ---- */}
      <section className="card">
        <h3>ラグプロファイル（lag 別の相関）とローリング相関</h3>
        {lags.error && <ErrorBanner message={lags.error} />}
        {lags.loading && <Loading />}
        {lags.data && (
          <div className="chart-row">
            <div className="chart-half">
              <h4>ラグ別相関（n={lags.data.n_obs}）</h4>
              <p className="muted">
                lag +1 = アジアの動きが翌営業日の米国に先行することを意味します。
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={lagBars}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="lag" tickFormatter={(v: number) => (v > 0 ? `+${v}` : `${v}`)} />
                  <YAxis domain={[-1, 1]} />
                  <Tooltip
                    formatter={tooltipCorr}
                    labelFormatter={(label) => `lag ${label}`}
                  />
                  <ReferenceLine y={0} stroke="#999" />
                  <Bar dataKey="corr" name="相関">
                    {lagBars.map((entry) => (
                      <Cell key={entry.lag} fill={corrColor(entry.corr)} stroke="#ccc" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-half">
              <h4>ローリング相関（同日）</h4>
              <p className="muted">窓: {rollingWindows.join(" / ")} 営業日</p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={rollingData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={40} />
                  <YAxis domain={[-1, 1]} />
                  <Tooltip formatter={tooltipCorr} />
                  <Legend />
                  <ReferenceLine y={0} stroke="#999" />
                  {rollingWindows.map((w) => (
                    <Line
                      key={w}
                      type="monotone"
                      dataKey={`w${w}`}
                      name={`${w}日`}
                      stroke={ROLLING_COLORS[`w${w}`] ?? "#7e57c2"}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* ---- バックテスト ---- */}
      <section className="card">
        <h3>条件付き統計（σ超過日のバックテスト）</h3>
        {backtest.error && <ErrorBanner message={backtest.error} />}
        {backtest.loading && <Loading />}
        {stats && pricing && (
          <>
            <div className="table-scroll">
              <table className="stats-table">
                <tbody>
                  <tr>
                    <th>トリガー日数</th>
                    <td>{stats.n_trigger_days}日</td>
                    <th>ヒット率（符号一致率）</th>
                    <td>{formatPct(stats.hit_rate, 0, false)}</td>
                    <th>ベースラインヒット率</th>
                    <td>{formatPct(stats.baseline_hit_rate, 0, false)}</td>
                  </tr>
                  <tr>
                    <th>平均米国リターン</th>
                    <td>{formatPct(stats.mean_us_return, 2)}</td>
                    <th>平均残余リターン（寄り→引け）</th>
                    <td>{formatPct(stats.mean_us_residual, 2)}</td>
                    <th>平均ギャップ（前日終値→寄り）</th>
                    <td>{formatPct(stats.mean_gap, 2)}</td>
                  </tr>
                  <tr>
                    <th>平均寄り→引け</th>
                    <td>{formatPct(stats.mean_open_to_close, 2)}</td>
                    <th>ギャップ比率の中央値（織り込み度）</th>
                    <td>{formatPct(pricing.median_gap_ratio, 0, false)}</td>
                    <th>残余リターンが正の割合</th>
                    <td>{formatPct(pricing.pct_positive_residual, 0, false)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h4>トリガー日明細（{pricing.n}件）</h4>
            <div className="table-scroll">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>アジアリターン</th>
                    <th>σスコア</th>
                    <th>米国トータル</th>
                    <th>ギャップ</th>
                    <th>寄り→引け</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.detail.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{formatPct(d.asia_return, 2)}</td>
                      <td>{formatSigma(d.sigma_score)}</td>
                      <td>{formatPct(d.us_total, 2)}</td>
                      <td>{formatPct(d.us_gap, 2)}</td>
                      <td>{formatPct(d.us_open_to_close, 2)}</td>
                    </tr>
                  ))}
                  {pricing.detail.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        トリガー日がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function PairView() {
  const watchlist = useFetch(() => api.watchlist(), []);
  const options = useMemo(
    () => (watchlist.data ? buildPairOptions(watchlist.data) : []),
    [watchlist.data],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected =
    options.find((o) => o.key === selectedKey) ?? options[0] ?? null;

  return (
    <div>
      {watchlist.error && <ErrorBanner message={watchlist.error} />}
      {watchlist.loading && <Loading />}
      {options.length > 0 && (
        <div className="controls">
          <label className="control-label" htmlFor="pair-select">
            ペア選択:
          </label>
          <select
            id="pair-select"
            value={selected?.key ?? ""}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                [{o.layerName}] {o.asiaName} ({o.asia}) → {o.usName} ({o.us})
              </option>
            ))}
          </select>
        </div>
      )}
      {selected && <PairDetail key={selected.key} pair={selected} />}
    </div>
  );
}
