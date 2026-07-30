"""シグナル層: 合成データでトリガー検出〜強度判定までを通しで確認。"""
from datetime import date

import numpy as np
import pandas as pd

from app.config import AppConfig, load_config
from app.data.cache import PriceCache
from app.data.service import DataService
from app.domain.models import AnalysisParams, Instrument, Layer
from app.signals.engine import SignalEngine
from tests.fixtures import synthetic_pair


def build_config() -> AppConfig:
    layer = Layer(
        id="LT", name="テスト層",
        leaders=(Instrument("ASIA.T", "アジア銘柄", "JP"),),
        targets=(Instrument("US1", "米国銘柄", "US"),),
    )
    return AppConfig(
        layers=(layer,), fx=(),
        benchmark=Instrument("^SPX", "S&P 500", "INDEX"),
        params=AnalysisParams(min_samples_for_signal=3),
    )


def test_signal_engine_detects_trigger(tmp_path):
    asia_df, us_df, spx_ret = synthetic_pair()
    # 最終日にアジア銘柄へ +6%（>2σ）のショックを注入
    asia_df = asia_df.copy()
    shock_close = asia_df["close"].iloc[-2] * 1.06
    asia_df.iloc[-1, asia_df.columns.get_loc("close")] = shock_close
    asia_df.iloc[-1, asia_df.columns.get_loc("high")] = shock_close * 1.01

    spx_close = 100 * (1 + spx_ret).cumprod()
    spx_df = pd.DataFrame({"open": spx_close, "high": spx_close, "low": spx_close,
                           "close": spx_close, "volume": 1e6}, index=spx_ret.index)

    cache = PriceCache(tmp_path / "sig.db")
    cache.upsert("ASIA.T", asia_df)
    cache.upsert("US1", us_df)
    cache.upsert("^SPX", spx_df)

    engine = SignalEngine(build_config(), DataService([], cache, throttle_sec=0))
    as_of = asia_df.index[-1].date()
    result = engine.run(as_of=as_of, refresh=False, with_premarket=False)

    assert len(result["signals"]) == 1
    s = result["signals"][0]
    assert s.asia_symbol == "ASIA.T" and s.us_symbol == "US1"
    assert s.asia_sigma >= 2.0
    assert s.strength in ("strong", "moderate", "weak")
    assert "ヒット率" in s.rationale
    assert result["errors"] == []


def test_no_signal_on_quiet_day(tmp_path):
    asia_df, us_df, spx_ret = synthetic_pair()
    # ショックなし: 最終日のリターンを 0 に均す
    asia_df = asia_df.copy()
    asia_df.iloc[-1, asia_df.columns.get_loc("close")] = asia_df["close"].iloc[-2]

    cache = PriceCache(tmp_path / "sig.db")
    cache.upsert("ASIA.T", asia_df)
    cache.upsert("US1", us_df)
    spx_close = 100 * (1 + spx_ret).cumprod()
    cache.upsert("^SPX", pd.DataFrame(
        {"open": spx_close, "high": spx_close, "low": spx_close,
         "close": spx_close, "volume": 1e6}, index=spx_ret.index))

    engine = SignalEngine(build_config(), DataService([], cache, throttle_sec=0))
    result = engine.run(as_of=asia_df.index[-1].date(), refresh=False, with_premarket=False)
    assert result["signals"] == []
    assert result["summary"] == "シグナルなし"


def test_default_config_loads():
    cfg = load_config()
    assert len(cfg.layers) == 5
    assert "000660.KS" in cfg.all_symbols()
    assert cfg.find_pair("9984.T", "ARM") is not None
    assert cfg.params.sigma_threshold == 2.0
