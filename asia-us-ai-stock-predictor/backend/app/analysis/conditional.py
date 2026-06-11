"""条件付き分析: アジア銘柄が ±kσ 以上動いた日に限定した米国側の統計。

通常日と分けて評価する。米国側は「ギャップ（織り込み済み）」と
「寄り→引け（残余）」、さらにベータ分解後の固有リターンでも評価する。
"""
from __future__ import annotations

import pandas as pd

from app.analysis.beta import rolling_beta_residual
from app.analysis.returns import gap_and_intraday, sigma_score
from app.domain.models import AnalysisParams, ConditionalStats


def _hit_rate(asia: pd.Series, us: pd.Series) -> float | None:
    """符号一致率。どちらかが 0 の日は分母から除く。"""
    mask = (asia != 0) & (us != 0)
    if mask.sum() == 0:
        return None
    return float(((asia[mask] > 0) == (us[mask] > 0)).mean())


def conditional_stats(
    asia_symbol: str,
    us_symbol: str,
    asia_ret: pd.Series,
    us_ohlc: pd.DataFrame,
    spx_ret: pd.Series,
    params: AnalysisParams,
    direction: str = "all",
) -> ConditionalStats:
    decomp = gap_and_intraday(us_ohlc)
    resid = rolling_beta_residual(decomp["total"], spx_ret, params.beta_window)["residual"]
    score = sigma_score(asia_ret, params.sigma_window)

    # 同一カレンダー日で突き合わせ（アジア引け → 同日の米国セッション）
    df = pd.concat(
        {"asia": asia_ret, "score": score, "us_total": decomp["total"],
         "gap": decomp["gap"], "o2c": decomp["open_to_close"], "resid": resid},
        axis=1, join="inner",
    ).dropna(subset=["asia", "score", "us_total"])

    trig = df[df["score"].abs() >= params.sigma_threshold]
    if direction == "up":
        trig = trig[trig["asia"] > 0]
    elif direction == "down":
        trig = trig[trig["asia"] < 0]

    def _mean(col: str) -> float | None:
        s = trig[col].dropna()
        return float(s.mean()) if len(s) else None

    return ConditionalStats(
        asia=asia_symbol,
        us=us_symbol,
        direction=direction,
        n_trigger_days=len(trig),
        hit_rate=_hit_rate(trig["asia"], trig["us_total"]),
        mean_us_return=_mean("us_total"),
        mean_us_residual=_mean("resid"),
        mean_gap=_mean("gap"),
        mean_open_to_close=_mean("o2c"),
        baseline_hit_rate=_hit_rate(df["asia"], df["us_total"]),
        trigger_dates=[d.date().isoformat() for d in trig.index],
    )


def trigger_table(asia_ret: pd.Series, us_ohlc: pd.DataFrame,
                  params: AnalysisParams) -> pd.DataFrame:
    """バックテスト表示用: トリガー日ごとの明細。"""
    decomp = gap_and_intraday(us_ohlc)
    score = sigma_score(asia_ret, params.sigma_window)
    df = pd.concat(
        {"asia": asia_ret, "score": score, "us_total": decomp["total"],
         "gap": decomp["gap"], "o2c": decomp["open_to_close"]},
        axis=1, join="inner",
    ).dropna()
    return df[df["score"].abs() >= params.sigma_threshold]
