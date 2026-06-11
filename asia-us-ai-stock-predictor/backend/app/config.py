"""設定読み込み。ウォッチリスト・分析パラメータの DI ルート。"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.domain.models import AnalysisParams, Instrument, Layer

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "watchlist.json"


@dataclass(frozen=True)
class AppConfig:
    layers: tuple[Layer, ...]
    fx: tuple[Instrument, ...]
    benchmark: Instrument
    params: AnalysisParams

    def all_symbols(self) -> list[str]:
        seen: dict[str, None] = {}
        for layer in self.layers:
            for inst in (*layer.leaders, *layer.targets):
                seen.setdefault(inst.symbol)
        for inst in self.fx:
            seen.setdefault(inst.symbol)
        seen.setdefault(self.benchmark.symbol)
        return list(seen)

    def us_symbols(self) -> list[str]:
        seen: dict[str, None] = {}
        for layer in self.layers:
            for inst in layer.targets:
                seen.setdefault(inst.symbol)
        return list(seen)

    def find_pair(self, asia: str, us: str) -> tuple[Layer, Instrument, Instrument] | None:
        for layer in self.layers:
            a = next((i for i in layer.leaders if i.symbol == asia), None)
            u = next((i for i in layer.targets if i.symbol == us), None)
            if a and u:
                return layer, a, u
        return None


def _instrument(raw: dict, default_market: str) -> Instrument:
    return Instrument(
        symbol=raw["symbol"],
        name=raw.get("name", raw["symbol"]),
        market=raw.get("market", default_market),
        note=raw.get("note", ""),
        adr=raw.get("adr", ""),
    )


def load_config(path: Path | str = DEFAULT_CONFIG_PATH) -> AppConfig:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    layers = tuple(
        Layer(
            id=l["id"],
            name=l["name"],
            leaders=tuple(_instrument(i, "JP") for i in l["leaders"]),
            targets=tuple(_instrument(i, "US") for i in l["targets"]),
        )
        for l in raw["layers"]
    )
    fx = tuple(_instrument(i, "FX") for i in raw.get("fx", []))
    benchmark = _instrument(raw["benchmark"], "INDEX")
    p = raw.get("analysis", {})
    params = AnalysisParams(
        sigma_window=p.get("sigma_window", 120),
        sigma_threshold=p.get("sigma_threshold", 2.0),
        rolling_windows=tuple(p.get("rolling_windows", [20, 60, 120])),
        lag_range=tuple(p.get("lag_range", [-3, 3])),
        beta_window=p.get("beta_window", 120),
        min_samples_for_signal=p.get("min_samples_for_signal", 10),
        hit_rate_strong=p.get("hit_rate_strong", 0.65),
        hit_rate_moderate=p.get("hit_rate_moderate", 0.55),
    )
    return AppConfig(layers=layers, fx=fx, benchmark=benchmark, params=params)
