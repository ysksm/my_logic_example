"""ドメインモデル。全層で共有する型定義のみを置く（ロジックは持たない）。"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    market: str  # "JP" | "KR" | "EU" | "US" | "FX" | "INDEX"
    note: str = ""
    adr: str = ""


@dataclass(frozen=True)
class Layer:
    id: str
    name: str
    leaders: tuple[Instrument, ...]
    targets: tuple[Instrument, ...]

    def pairs(self) -> list[tuple[Instrument, Instrument]]:
        return [(a, u) for a in self.leaders for u in self.targets]


@dataclass(frozen=True)
class AnalysisParams:
    sigma_window: int = 120
    sigma_threshold: float = 2.0
    rolling_windows: tuple[int, ...] = (20, 60, 120)
    lag_range: tuple[int, int] = (-3, 3)
    beta_window: int = 120
    min_samples_for_signal: int = 10
    hit_rate_strong: float = 0.65
    hit_rate_moderate: float = 0.55


@dataclass
class LagCorrelationResult:
    asia: str
    us: str
    n_obs: int
    by_lag: dict[int, float]  # lag -> ピアソン相関。lag>0: アジアが先行
    rolling: dict[int, list[dict]]  # window -> [{date, corr}] (lag=0)


@dataclass
class ConditionalStats:
    """アジア側が±kσ以上動いた日に限定した米国側の統計。"""
    asia: str
    us: str
    direction: str  # "up" | "down" | "all"
    n_trigger_days: int
    hit_rate: float | None  # 符号一致率
    mean_us_return: float | None
    mean_us_residual: float | None  # ベータ分解後の固有リターン
    mean_gap: float | None  # 寄り付きまでに織り込まれた分
    mean_open_to_close: float | None  # 残余（寄り後）リターン
    baseline_hit_rate: float | None  # 全日でのベースライン
    trigger_dates: list[str] = field(default_factory=list)


@dataclass
class Signal:
    date: str
    layer_id: str
    layer_name: str
    asia_symbol: str
    asia_name: str
    asia_return: float
    asia_sigma: float  # 当日リターン / σ
    us_symbol: str
    us_name: str
    stats: ConditionalStats
    premarket_move: float | None  # 米プレマーケットでの既織り込み率（前日終値比）
    priced_in_ratio: float | None  # premarket_move / 期待値 の比率
    strength: str  # "strong" | "moderate" | "weak" | "none"
    rationale: str
