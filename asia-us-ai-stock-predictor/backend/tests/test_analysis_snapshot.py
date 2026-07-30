"""既知データ（シード固定の合成ペア）に対するスナップショットテスト。

合成データは「アジア固有要因に米国銘柄が同日夜 β=0.6 で追随し、
その7割がギャップで織り込まれる」構造を持つ。分析ロジックが
この構造を正しく検出できること、および結果が回帰しないことを確認する。
"""
import json
from pathlib import Path

import numpy as np

from app.analysis.conditional import conditional_stats
from app.analysis.lag_correlation import analyze_pair
from app.analysis.pricing_in import pricing_in_summary
from app.analysis.returns import daily_returns
from app.domain.models import AnalysisParams
from tests.fixtures import synthetic_pair

GOLDEN = Path(__file__).parent / "golden" / "analysis_snapshot.json"
PARAMS = AnalysisParams()


def compute_snapshot() -> dict:
    asia_df, us_df, spx_ret = synthetic_pair()
    asia_ret = daily_returns(asia_df["close"])
    us_ret = daily_returns(us_df["close"])

    lag = analyze_pair("ASIA", "US", asia_ret, us_ret, PARAMS)
    cond = conditional_stats("ASIA", "US", asia_ret, us_df, spx_ret, PARAMS, "all")
    pricing = pricing_in_summary(asia_ret, us_df, PARAMS)
    return {
        "lag_profile": {str(k): round(v, 4) for k, v in lag.by_lag.items()},
        "n_obs": lag.n_obs,
        "rolling_last": {str(w): s[-1]["corr"] for w, s in lag.rolling.items() if s},
        "conditional": {
            "n_trigger_days": cond.n_trigger_days,
            "hit_rate": round(cond.hit_rate, 4),
            "baseline_hit_rate": round(cond.baseline_hit_rate, 4),
            "mean_us_return": round(cond.mean_us_return, 6),
            "mean_gap": round(cond.mean_gap, 6),
            "mean_open_to_close": round(cond.mean_open_to_close, 6),
            "mean_us_residual": round(cond.mean_us_residual, 6),
        },
        "pricing_in": {
            "n": pricing["n"],
            "median_gap_ratio": round(pricing["median_gap_ratio"], 4),
            "pct_positive_residual": round(pricing["pct_positive_residual"], 4),
        },
    }


def test_detects_known_structure():
    snap = compute_snapshot()
    # 同日（lag=0）の相関が前後のラグより明確に高い
    lag0 = snap["lag_profile"]["0"]
    assert lag0 > 0.3
    assert lag0 > snap["lag_profile"]["1"] + 0.2
    assert lag0 > snap["lag_profile"]["-1"] + 0.2
    # トリガー日のヒット率がベースラインを上回る
    c = snap["conditional"]
    assert c["n_trigger_days"] >= 5
    assert c["hit_rate"] > c["baseline_hit_rate"]
    # ギャップが追随分の大半を織り込む構造（GAP_SHARE=0.7）を検出
    assert 0.4 < snap["pricing_in"]["median_gap_ratio"] < 1.1


def test_snapshot_matches_golden():
    snap = compute_snapshot()
    if not GOLDEN.exists():  # 初回はゴールデンを生成（コミットして固定する）
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(json.dumps(snap, indent=2, ensure_ascii=False), encoding="utf-8")
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))

    def assert_close(a, b, path=""):
        if isinstance(a, dict):
            assert a.keys() == b.keys(), f"keys differ at {path}"
            for k in a:
                assert_close(a[k], b[k], f"{path}.{k}")
        elif isinstance(a, float):
            assert np.isclose(a, b, rtol=1e-4, atol=1e-6), f"{path}: {a} != {b}"
        else:
            assert a == b, f"{path}: {a} != {b}"

    assert_close(snap, golden)
