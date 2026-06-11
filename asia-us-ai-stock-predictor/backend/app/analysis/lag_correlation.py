"""ラグ付き相関分析。

lag の符号規約: corr(asia(t), us(t+lag))
  lag = 0  … 同一カレンダー日（アジア引け → その夜の米国セッション）
  lag > 0  … アジアが lag 営業日先行
  lag < 0  … 米国が先行（支配的な「米国→アジア」方向の参照値）
"""
from __future__ import annotations

import pandas as pd

from app.analysis.returns import align_pair
from app.domain.models import AnalysisParams, LagCorrelationResult


def lag_profile(asia_ret: pd.Series, us_ret: pd.Series,
                lag_range: tuple[int, int]) -> dict[int, float]:
    profile = {}
    for lag in range(lag_range[0], lag_range[1] + 1):
        df = align_pair(asia_ret, us_ret, lag)
        profile[lag] = float(df["asia"].corr(df["us"])) if len(df) >= 20 else float("nan")
    return profile


def rolling_correlation(asia_ret: pd.Series, us_ret: pd.Series,
                        windows: tuple[int, ...], lag: int = 0) -> dict[int, pd.Series]:
    df = align_pair(asia_ret, us_ret, lag)
    return {
        w: df["asia"].rolling(w, min_periods=w).corr(df["us"]).dropna()
        for w in windows
    }


def analyze_pair(asia_symbol: str, us_symbol: str,
                 asia_ret: pd.Series, us_ret: pd.Series,
                 params: AnalysisParams) -> LagCorrelationResult:
    aligned = align_pair(asia_ret, us_ret, 0)
    rolling = rolling_correlation(asia_ret, us_ret, params.rolling_windows, lag=0)
    return LagCorrelationResult(
        asia=asia_symbol,
        us=us_symbol,
        n_obs=len(aligned),
        by_lag=lag_profile(asia_ret, us_ret, params.lag_range),
        rolling={
            w: [{"date": d.date().isoformat(), "corr": round(float(v), 4)}
                for d, v in s.items()]
            for w, s in rolling.items()
        },
    )
