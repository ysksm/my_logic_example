"""FastAPI プレゼンテーション層。分析ロジックは持たず、各層の呼び出しに徹する。"""
from __future__ import annotations

import dataclasses
import os
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.analysis.conditional import conditional_stats
from app.analysis.lag_correlation import analyze_pair
from app.analysis.pricing_in import pricing_in_summary
from app.analysis.returns import align_pair, daily_returns
from app.config import DEFAULT_CONFIG_PATH, AppConfig, load_config
from app.data.cache import PriceCache
from app.data.service import DataService
from app.data.yfinance_source import YFinanceSource
from app.signals.engine import HISTORY_DAYS, SignalEngine

DB_PATH = Path(os.environ.get("PREDICTOR_DB", Path(__file__).resolve().parents[2] / "data" / "prices.db"))
CONFIG_PATH = Path(os.environ.get("PREDICTOR_CONFIG", DEFAULT_CONFIG_PATH))


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    return load_config(CONFIG_PATH)


@lru_cache(maxsize=1)
def get_data_service() -> DataService:
    return DataService(sources=[YFinanceSource()], cache=PriceCache(DB_PATH))


app = FastAPI(title="Asia→US AI Stock Predictor")
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"],
)


def _history_start() -> date:
    return date.today() - timedelta(days=int(HISTORY_DAYS * 1.6))


def _pair_returns(asia: str, us: str, refresh: bool = False):
    svc = get_data_service()
    start = _history_start()
    a_df, a_stale = svc.get_daily(asia, start, refresh=refresh)
    u_df, u_stale = svc.get_daily(us, start, refresh=refresh)
    if a_df.empty or u_df.empty:
        raise HTTPException(404, f"price data not cached for {asia if a_df.empty else us}; "
                                 "run POST /api/data/refresh first")
    return a_df, u_df, a_stale or u_stale


@app.get("/api/watchlist")
def watchlist():
    cfg = get_config()
    return {
        "layers": [dataclasses.asdict(l) for l in cfg.layers],
        "fx": [dataclasses.asdict(i) for i in cfg.fx],
        "benchmark": dataclasses.asdict(cfg.benchmark),
        "params": dataclasses.asdict(cfg.params),
    }


@app.get("/api/heatmap")
def heatmap(window: int = Query(120), lag: int = Query(0)):
    """レイヤー別 × ペア別の相関マトリクス。直近 window 営業日の相関。"""
    cfg = get_config()
    svc = get_data_service()
    start = _history_start()
    rets: dict[str, object] = {}

    def ret_of(symbol: str):
        if symbol not in rets:
            df, _ = svc.get_daily(symbol, start, refresh=False)
            rets[symbol] = daily_returns(df["close"]) if not df.empty else None
        return rets[symbol]

    out = []
    for layer in cfg.layers:
        cells = []
        for leader in layer.leaders:
            for target in layer.targets:
                a, u = ret_of(leader.symbol), ret_of(target.symbol)
                corr = None
                n = 0
                if a is not None and u is not None:
                    df = align_pair(a.tail(window + abs(lag) + 5), u, lag).tail(window)
                    n = len(df)
                    if n >= 20:
                        corr = round(float(df["asia"].corr(df["us"])), 4)
                cells.append({"asia": leader.symbol, "asia_name": leader.name,
                              "us": target.symbol, "us_name": target.name,
                              "corr": corr, "n": n})
        out.append({"layer_id": layer.id, "layer_name": layer.name, "cells": cells})
    return {"window": window, "lag": lag, "layers": out}


@app.get("/api/pair/{asia}/{us}/lags")
def pair_lags(asia: str, us: str):
    cfg = get_config()
    a_df, u_df, stale = _pair_returns(asia, us)
    result = analyze_pair(asia, us, daily_returns(a_df["close"]),
                          daily_returns(u_df["close"]), cfg.params)
    return {**dataclasses.asdict(result), "stale": stale}


@app.get("/api/pair/{asia}/{us}/overlay")
def pair_overlay(asia: str, us: str, days: int = Query(250)):
    """時差補正済み重ね合わせ。同一カレンダー日 t のアジア終値と米国終値を並べ、
    期間初日 = 100 に正規化した系列を返す（正規化はフロント側ロジックでも再計算可能）。"""
    a_df, u_df, stale = _pair_returns(asia, us)
    a = a_df["close"].tail(days)
    u = u_df["close"].tail(days)
    dates = sorted(set(a.index) | set(u.index))
    return {
        "asia": asia, "us": us, "stale": stale,
        "series": [
            {"date": d.date().isoformat(),
             "asia_close": float(a[d]) if d in a.index else None,
             "us_close": float(u[d]) if d in u.index else None}
            for d in dates
        ],
    }


@app.get("/api/pair/{asia}/{us}/backtest")
def pair_backtest(asia: str, us: str, direction: str = Query("all")):
    cfg = get_config()
    svc = get_data_service()
    a_df, u_df, stale = _pair_returns(asia, us)
    spx_df, _ = svc.get_daily(cfg.benchmark.symbol, _history_start(), refresh=False)
    if spx_df.empty:
        raise HTTPException(404, "benchmark not cached; run POST /api/data/refresh first")
    a_ret = daily_returns(a_df["close"])
    stats = conditional_stats(asia, us, a_ret, u_df,
                              daily_returns(spx_df["close"]), cfg.params, direction)
    pricing = pricing_in_summary(a_ret, u_df, cfg.params)
    return {"stats": dataclasses.asdict(stats), "pricing_in": pricing, "stale": stale}


@app.get("/api/signals/today")
def signals_today(refresh: bool = Query(False), premarket: bool = Query(True)):
    engine = SignalEngine(get_config(), get_data_service())
    result = engine.run(refresh=refresh, with_premarket=premarket)
    result["signals"] = [dataclasses.asdict(s) for s in result["signals"]]
    return result


@app.post("/api/data/refresh")
def refresh_data():
    cfg = get_config()
    svc = get_data_service()
    return {"results": svc.refresh_all(cfg.all_symbols(), _history_start())}
