import numpy as np
import pandas as pd

from app.analysis.returns import (
    align_pair, daily_returns, gap_and_intraday, sigma_score, to_usd,
)


def test_daily_returns_simple():
    s = pd.Series([100.0, 110.0, 99.0], index=pd.bdate_range("2024-01-01", periods=3))
    r = daily_returns(s)
    assert np.isclose(r.iloc[0], 0.10)
    assert np.isclose(r.iloc[1], -0.10)


def test_gap_and_intraday_decomposition_sums_to_total():
    idx = pd.bdate_range("2024-01-01", periods=3)
    df = pd.DataFrame({"open": [100, 102, 98], "high": [105, 103, 100],
                       "low": [99, 97, 95], "close": [101, 99, 99],
                       "volume": [1, 1, 1]}, index=idx, dtype=float)
    d = gap_and_intraday(df)
    # (1+gap)*(1+open_to_close) - 1 == total
    recomposed = (1 + d["gap"]) * (1 + d["open_to_close"]) - 1
    assert np.allclose(recomposed, d["total"])
    assert np.isclose(d["gap"].iloc[0], 102 / 101 - 1)


def test_sigma_score_has_no_lookahead():
    idx = pd.bdate_range("2023-01-02", periods=200)
    rng = np.random.default_rng(0)
    ret = pd.Series(rng.normal(0, 0.01, 200), index=idx)
    # 最終日に巨大リターンを置いても、その日のσには影響しない（shift(1)のため）
    ret.iloc[-1] = 0.50
    score_with = sigma_score(ret, 120)
    sigma_prior = ret.iloc[:-1].rolling(120).std().iloc[-1]
    assert np.isclose(score_with.iloc[-1], 0.50 / sigma_prior, rtol=1e-6)


def test_align_pair_lag_shift():
    idx = pd.bdate_range("2024-01-01", periods=10)
    asia = pd.Series(range(10), index=idx, dtype=float)
    us = asia.copy()
    # lag=1: アジア(t) vs 米国(t+1) → 米国側の値が1営業日後のもの
    df = align_pair(asia, us, lag=1)
    assert (df["us"] - df["asia"] == 1).all()
    df0 = align_pair(asia, us, lag=0)
    assert (df0["us"] == df0["asia"]).all()


def test_to_usd_conversion():
    idx = pd.bdate_range("2024-01-01", periods=3)
    jpy_close = pd.Series([15000.0, 15000.0, 15000.0], index=idx)
    usd_per_jpy = pd.Series([1 / 150.0, 1 / 150.0, 1 / 100.0], index=idx)
    usd = to_usd(jpy_close, usd_per_jpy)
    assert np.isclose(usd.iloc[0], 100.0)
    assert np.isclose(usd.iloc[2], 150.0)
