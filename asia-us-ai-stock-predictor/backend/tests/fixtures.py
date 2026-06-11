"""テスト用の決定的な合成データ生成。

シード固定の乱数で「アジア銘柄が先行し、米国銘柄が同日夜に追随する」
構造を持つ価格系列を作る。スナップショットテストの既知データとして使う。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

SEED = 42
N_DAYS = 400
FOLLOW_BETA = 0.6  # 米国銘柄がアジアリターンに追随する強さ
GAP_SHARE = 0.7    # 追随分のうちギャップ（寄り付きまで）で織り込まれる割合


def business_days(n: int = N_DAYS) -> pd.DatetimeIndex:
    return pd.bdate_range("2023-01-02", periods=n)


def synthetic_pair() -> tuple[pd.DataFrame, pd.DataFrame, pd.Series]:
    """(アジア銘柄OHLCV, 米国銘柄OHLCV, S&P500リターン) を返す。"""
    rng = np.random.default_rng(SEED)
    idx = business_days()
    n = len(idx)

    spx_ret = pd.Series(rng.normal(0.0003, 0.01, n), index=idx)
    asia_own = rng.normal(0.0005, 0.02, n)          # アジア固有要因
    asia_ret = pd.Series(asia_own + 0.5 * spx_ret.shift(1).fillna(0).values, index=idx)

    follow = FOLLOW_BETA * asia_own                  # 米国側が同日夜に追随する成分
    us_idio = rng.normal(0, 0.008, n)
    us_total = 1.0 * spx_ret.values + follow + us_idio
    us_gap = GAP_SHARE * follow + 0.3 * spx_ret.values + rng.normal(0, 0.003, n)

    def to_ohlc(returns: np.ndarray, gaps: np.ndarray | None = None) -> pd.DataFrame:
        close = 100 * np.cumprod(1 + returns)
        prev_close = np.concatenate([[100.0], close[:-1]])
        opens = prev_close * (1 + gaps) if gaps is not None else prev_close * (1 + returns * 0.3)
        high = np.maximum(opens, close) * 1.005
        low = np.minimum(opens, close) * 0.995
        return pd.DataFrame({"open": opens, "high": high, "low": low,
                             "close": close, "volume": 1e6}, index=idx)

    asia_df = to_ohlc(asia_ret.values)
    us_df = to_ohlc(us_total, us_gap)
    return asia_df, us_df, spx_ret
