"""リターン計算・σ正規化・通貨換算。"""
from __future__ import annotations

import numpy as np
import pandas as pd


def daily_returns(close: pd.Series) -> pd.Series:
    """終値ベースの日次対数近似ではなく単純リターン。"""
    return close.pct_change().dropna()


def to_usd(close_local: pd.Series, fx_usd_per_local: pd.Series) -> pd.Series:
    """現地通貨建て終値を USD 換算する。

    fx_usd_per_local: 現地通貨1単位あたりの USD（例: JPY なら 1/USDJPY）。
    日付で前方補完して結合する。
    """
    fx = fx_usd_per_local.reindex(close_local.index, method="ffill")
    return (close_local * fx).dropna()


def rolling_sigma(returns: pd.Series, window: int) -> pd.Series:
    """ローリング標準偏差。当日を含めない（look-ahead 回避のため shift(1)）。"""
    return returns.rolling(window, min_periods=max(20, window // 2)).std().shift(1)


def sigma_score(returns: pd.Series, window: int) -> pd.Series:
    """当日リターンを過去 window 日のσで割ったスコア。"""
    sigma = rolling_sigma(returns, window)
    return (returns / sigma).replace([np.inf, -np.inf], np.nan)


def gap_and_intraday(df: pd.DataFrame) -> pd.DataFrame:
    """日足 OHLC から「ギャップ（前日終値→寄り）」と「寄り→引け」に分解する。

    ギャップ = 時間外・先物で織り込まれた分、寄り→引け = 残余リターン。
    """
    prev_close = df["close"].shift(1)
    out = pd.DataFrame(index=df.index)
    out["gap"] = df["open"] / prev_close - 1.0
    out["open_to_close"] = df["close"] / df["open"] - 1.0
    out["total"] = df["close"] / prev_close - 1.0
    return out.dropna()


def align_pair(asia_ret: pd.Series, us_ret: pd.Series, lag: int = 0) -> pd.DataFrame:
    """アジア(t) と 米国(t+lag) を突き合わせる。

    日足はどちらも取引所ローカル日付。lag=0 は同一カレンダー日
    （アジア引けが米国セッション開始に先行）。lag>0 はアジアがさらに先行。
    祝日ずれは両系列の共通営業日ベース（米国側の営業日インデックスを lag シフト）
    で吸収する。
    """
    us_shifted = us_ret.copy()
    us_shifted.index = us_shifted.index - pd.tseries.offsets.BDay(lag) if lag else us_shifted.index
    df = pd.concat({"asia": asia_ret, "us": us_shifted}, axis=1, join="inner").dropna()
    return df
