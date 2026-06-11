"""シグナル層: アジア・欧州引け後に実行し、トリガー銘柄と統計的根拠を提示する。

推奨は行わない。出力は「過去の条件付き統計 + 当日の織り込み状況」の事実提示に徹する。
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

import pandas as pd

from app.analysis.conditional import conditional_stats
from app.analysis.returns import daily_returns, sigma_score
from app.config import AppConfig
from app.data.service import DataService
from app.domain.models import ConditionalStats, Signal

logger = logging.getLogger(__name__)

HISTORY_DAYS = 750  # 統計算出に使う過去日数（約3年）


class SignalEngine:
    def __init__(self, config: AppConfig, data: DataService) -> None:
        self.config = config
        self.data = data

    def _strength(self, stats: ConditionalStats, priced_in_ratio: float | None) -> tuple[str, str]:
        p = self.config.params
        reasons = []
        if stats.n_trigger_days < p.min_samples_for_signal:
            return "none", f"サンプル数不足（{stats.n_trigger_days}日 < {p.min_samples_for_signal}日）"
        hr = stats.hit_rate or 0.0
        reasons.append(f"条件付きヒット率 {hr:.0%}（n={stats.n_trigger_days}, "
                       f"ベースライン {stats.baseline_hit_rate:.0%}）")
        if stats.mean_open_to_close is not None:
            reasons.append(f"平均残余リターン（寄り→引け） {stats.mean_open_to_close:+.2%}")
        if priced_in_ratio is not None:
            reasons.append(f"プレマーケット織り込み比率 {priced_in_ratio:.0%}")
            if priced_in_ratio >= 1.0:
                reasons.append("期待変動は時間外で概ね織り込み済み")

        if hr >= p.hit_rate_strong and (priced_in_ratio is None or priced_in_ratio < 1.0):
            return "strong", "、".join(reasons)
        if hr >= p.hit_rate_moderate:
            return "moderate", "、".join(reasons)
        return "weak", "、".join(reasons)

    def run(self, as_of: date | None = None, refresh: bool = True,
            with_premarket: bool = True) -> dict:
        as_of = as_of or date.today()
        start = as_of - timedelta(days=int(HISTORY_DAYS * 1.6))
        p = self.config.params

        # ベンチマーク
        spx, _ = self.data.get_daily(self.config.benchmark.symbol, start, as_of, refresh)
        spx_ret = daily_returns(spx["close"]) if not spx.empty else pd.Series(dtype=float)

        signals: list[Signal] = []
        errors: list[dict] = []
        premarket_cache: dict[str, dict | None] = {}

        for layer in self.config.layers:
            for leader in layer.leaders:
                try:
                    df, _ = self.data.get_daily(leader.symbol, start, as_of, refresh)
                    if df.empty or df.index[-1].date() < as_of - timedelta(days=5):
                        continue  # データが古すぎる（上場廃止等）
                    ret = daily_returns(df["close"])
                    score = sigma_score(ret, p.sigma_window)
                    if score.empty or pd.isna(score.iloc[-1]):
                        continue
                    last_date = ret.index[-1].date()
                    last_score = float(score.iloc[-1])
                    if abs(last_score) < p.sigma_threshold or last_date != as_of:
                        continue
                except Exception as e:  # noqa: BLE001
                    errors.append({"symbol": leader.symbol, "error": str(e)})
                    continue

                direction = "up" if ret.iloc[-1] > 0 else "down"
                for target in layer.targets:
                    try:
                        us_df, _ = self.data.get_daily(target.symbol, start, as_of, refresh=False)
                        if us_df.empty:
                            continue
                        stats = conditional_stats(
                            leader.symbol, target.symbol, ret, us_df, spx_ret, p,
                            direction=direction)
                        pm = None
                        if with_premarket:
                            if target.symbol not in premarket_cache:
                                premarket_cache[target.symbol] = \
                                    self.data.get_premarket_quote(target.symbol)
                            pm = premarket_cache[target.symbol]
                        pm_move = pm["move"] if pm else None
                        expected = stats.mean_us_return
                        priced_in = (pm_move / expected
                                     if pm_move is not None and expected
                                     and abs(expected) >= 0.001 else None)
                        strength, rationale = self._strength(stats, priced_in)
                        signals.append(Signal(
                            date=as_of.isoformat(),
                            layer_id=layer.id, layer_name=layer.name,
                            asia_symbol=leader.symbol, asia_name=leader.name,
                            asia_return=round(float(ret.iloc[-1]), 4),
                            asia_sigma=round(last_score, 2),
                            us_symbol=target.symbol, us_name=target.name,
                            stats=stats,
                            premarket_move=pm_move,
                            priced_in_ratio=priced_in,
                            strength=strength, rationale=rationale,
                        ))
                    except Exception as e:  # noqa: BLE001
                        errors.append({"symbol": f"{leader.symbol}->{target.symbol}",
                                       "error": str(e)})

        order = {"strong": 0, "moderate": 1, "weak": 2, "none": 3}
        signals.sort(key=lambda s: (order[s.strength], -abs(s.asia_sigma)))
        return {"as_of": as_of.isoformat(), "signals": signals, "errors": errors,
                "summary": "シグナルあり" if any(s.strength in ("strong", "moderate")
                                            for s in signals) else "シグナルなし"}
