"""織り込み度の過去検証。

アジアのトリガー日について、米国側の当日リターンのうち
ギャップ（前日終値→寄り = 時間外で織り込まれた分）が占めた割合と、
寄り後に残った残余リターンの分布を測る。
「シグナルを見てから米国寄りで入った場合に取れたか」を答える指標。
"""
from __future__ import annotations

import pandas as pd

from app.analysis.conditional import trigger_table
from app.domain.models import AnalysisParams


def pricing_in_summary(asia_ret: pd.Series, us_ohlc: pd.DataFrame,
                       params: AnalysisParams) -> dict:
    trig = trigger_table(asia_ret, us_ohlc, params)
    if trig.empty:
        return {"n": 0}

    # アジアの方向に合わせた符号付きリターン（up トリガーはそのまま、down は反転）
    sign = (trig["asia"] > 0).astype(float) * 2 - 1
    directed_total = trig["us_total"] * sign
    directed_gap = trig["gap"] * sign
    directed_o2c = trig["o2c"] * sign

    # ギャップが総リターンに占めた比率（総リターンが小さすぎる日は除外）
    meaningful = directed_total.abs() >= 0.002
    ratio = (directed_gap[meaningful] / directed_total[meaningful]).clip(-3, 3)

    return {
        "n": int(len(trig)),
        "mean_directed_total": float(directed_total.mean()),
        "mean_directed_gap": float(directed_gap.mean()),
        "mean_directed_open_to_close": float(directed_o2c.mean()),
        "median_gap_ratio": float(ratio.median()) if len(ratio) else None,
        "pct_positive_residual": float((directed_o2c > 0).mean()),
        "detail": [
            {
                "date": d.date().isoformat(),
                "asia_return": round(float(r.asia), 4),
                "sigma_score": round(float(r.score), 2),
                "us_total": round(float(r.us_total), 4),
                "us_gap": round(float(r.gap), 4),
                "us_open_to_close": round(float(r.o2c), 4),
            }
            for d, r in trig.iterrows()
        ],
    }
