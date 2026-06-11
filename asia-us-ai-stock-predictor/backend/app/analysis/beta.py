"""S&P 500 ベータ分解。米国銘柄のリターンを市場要因と固有要因に分ける。"""
from __future__ import annotations

import numpy as np
import pandas as pd


def rolling_beta_residual(us_ret: pd.Series, spx_ret: pd.Series,
                          window: int) -> pd.DataFrame:
    """r_us(t) = α + β·r_spx(t) + ε(t) をローリング回帰し β と残差 ε を返す。

    β は look-ahead を避けるため t−1 までの window 日で推定し、
    ε(t) = r_us(t) − β̂(t−1)·r_spx(t) − α̂(t−1) とする。
    """
    df = pd.concat({"us": us_ret, "spx": spx_ret}, axis=1, join="inner").dropna()
    cov = df["us"].rolling(window, min_periods=window // 2).cov(df["spx"])
    var = df["spx"].rolling(window, min_periods=window // 2).var()
    beta = (cov / var).shift(1)
    alpha = (df["us"].rolling(window, min_periods=window // 2).mean()
             - (cov / var) * df["spx"].rolling(window, min_periods=window // 2).mean()).shift(1)
    residual = df["us"] - beta * df["spx"] - alpha
    out = pd.DataFrame({"beta": beta, "residual": residual, "us": df["us"], "spx": df["spx"]})
    return out.replace([np.inf, -np.inf], np.nan).dropna()
