import { useState } from "react";
import { api } from "../api/client";
import { useFetch } from "../api/useFetch";
import type { Signal } from "../api/types";
import { formatPct, formatSigma } from "../lib/format";
import { strengthLabel } from "../lib/strengthLabel";
import { ErrorBanner } from "./ErrorBanner";
import { Loading } from "./Loading";

function StrengthBadge({ strength }: { strength: string }) {
  const badge = strengthLabel(strength);
  return (
    <span className="badge" style={{ background: badge.bg, color: badge.fg }}>
      {badge.label}
    </span>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  return (
    <section className="card signal-card">
      <div className="signal-header">
        <StrengthBadge strength={signal.strength} />
        <span className="signal-title">
          {signal.asia_name} ({signal.asia_symbol}) → {signal.us_name} (
          {signal.us_symbol})
        </span>
        <span className="muted">
          {signal.layer_id}: {signal.layer_name}
        </span>
      </div>

      <div className="signal-grid">
        <div className="metric">
          <span className="metric-label">アジア側リターン</span>
          <span className="metric-value">{formatPct(signal.asia_return, 2)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">σスコア</span>
          <span className="metric-value">{formatSigma(signal.asia_sigma)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">過去ヒット率</span>
          <span className="metric-value">
            {formatPct(signal.stats.hit_rate, 0, false)}
            <span className="muted"> (n={signal.stats.n_trigger_days})</span>
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">平均残余リターン（寄り→引け）</span>
          <span className="metric-value">
            {formatPct(signal.stats.mean_us_residual, 2)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">プレマーケット変動</span>
          <span className="metric-value">{formatPct(signal.premarket_move, 2)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">織り込み度</span>
          <span className="metric-value">
            {formatPct(signal.priced_in_ratio, 0, false)}
          </span>
        </div>
      </div>

      <p className="rationale">{signal.rationale}</p>
    </section>
  );
}

export function SignalsView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useFetch(
    () => api.signalsToday(refreshKey > 0),
    [refreshKey],
  );

  return (
    <div>
      <div className="controls">
        <button className="toggle" onClick={() => setRefreshKey((k) => k + 1)}>
          最新データで再計算
        </button>
        {data && (
          <span className="muted">
            基準日: {data.as_of} ／ {data.summary}
          </span>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <Loading />}

      {data && data.errors.length > 0 && (
        <div className="warn-banner">
          一部の銘柄でデータ取得に失敗しました:{" "}
          {data.errors.map((e) => `${e.symbol} (${e.error})`).join(", ")}
        </div>
      )}

      {data && data.signals.length === 0 && (
        <p className="muted">本日のシグナルはありません。</p>
      )}
      {data &&
        data.signals.map((s) => (
          <SignalCard key={`${s.asia_symbol}-${s.us_symbol}`} signal={s} />
        ))}

      <p className="disclaimer">
        本レポートは統計的根拠の提示であり売買推奨ではありません。
      </p>
    </div>
  );
}
