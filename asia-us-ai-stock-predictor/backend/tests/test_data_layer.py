"""データ層: キャッシュ差分更新・フォールバックチェーン・リトライ。"""
from datetime import date

import pandas as pd
import pytest

from app.data.cache import PriceCache
from app.data.service import DataService
from app.data.source import empty_frame, normalize_ohlcv


def make_df(dates: list[str]) -> pd.DataFrame:
    idx = pd.DatetimeIndex(pd.to_datetime(dates), name="date")
    n = len(idx)
    return pd.DataFrame({"open": [100.0] * n, "high": [101.0] * n, "low": [99.0] * n,
                         "close": [100.5] * n, "volume": [1e6] * n}, index=idx)


class FakeSource:
    """呼び出し記録付きのフェイクソース。"""

    def __init__(self, name: str, df: pd.DataFrame | None = None,
                 fail: bool = False) -> None:
        self.name = name
        self.df = df if df is not None else empty_frame()
        self.fail = fail
        self.calls: list[tuple[date, date]] = []

    def fetch_daily(self, symbol: str, start: date, end: date) -> pd.DataFrame:
        self.calls.append((start, end))
        if self.fail:
            raise RuntimeError("boom")
        return self.df[(self.df.index >= pd.Timestamp(start))
                       & (self.df.index <= pd.Timestamp(end))]

    def fetch_intraday_prepost(self, symbol: str, days: int = 5) -> pd.DataFrame:
        return empty_frame()


@pytest.fixture
def cache(tmp_path):
    return PriceCache(tmp_path / "test.db")


def service(sources, cache):
    return DataService(sources, cache, throttle_sec=0, backoff_base_sec=0)


def test_cache_upsert_and_load(cache):
    cache.upsert("AAA", make_df(["2024-01-02", "2024-01-03"]))
    df = cache.load("AAA")
    assert len(df) == 2
    assert cache.last_date("AAA") == date(2024, 1, 3)


def test_incremental_update_only_fetches_missing_range(cache):
    src = FakeSource("fake", make_df(["2024-01-02", "2024-01-03", "2024-01-04"]))
    svc = service([src], cache)
    df, stale = svc.get_daily("AAA", date(2024, 1, 1), date(2024, 1, 3))
    assert len(df) == 2 and not stale
    # 2回目: キャッシュ最終日(1/3)の翌日からのみ取得
    df, _ = svc.get_daily("AAA", date(2024, 1, 1), date(2024, 1, 4))
    assert len(df) == 3
    assert src.calls[-1][0] == date(2024, 1, 4)


def test_fallback_chain_uses_second_source(cache):
    bad = FakeSource("bad", fail=True)
    good = FakeSource("good", make_df(["2024-01-02"]))
    svc = service([bad, good], cache)
    df, stale = svc.get_daily("AAA", date(2024, 1, 1), date(2024, 1, 2))
    assert len(df) == 1 and not stale
    assert len(bad.calls) == 3  # max_retries 回試行してからフォールバック


def test_all_sources_fail_serves_cache_as_stale(cache):
    cache.upsert("AAA", make_df(["2024-01-02"]))
    svc = service([FakeSource("bad", fail=True)], cache)
    df, stale = svc.get_daily("AAA", date(2024, 1, 1), date(2024, 1, 5))
    assert len(df) == 1 and stale


def test_normalize_ohlcv_handles_tz_and_case():
    idx = pd.DatetimeIndex(pd.to_datetime(["2024-01-02 00:00"]).tz_localize("America/New_York"))
    df = pd.DataFrame({"Open": [1.0], "High": [2.0], "Low": [0.5],
                       "Close": [1.5], "Volume": [10]}, index=idx)
    out = normalize_ohlcv(df)
    assert list(out.columns) == ["open", "high", "low", "close", "volume"]
    assert out.index.tz is None
