"""3ペア検証: SK hynix↔MU、SBG↔ARM、ASML↔AMAT を過去2年で検証する。

SBG↔ARM は ARM の株価が SBG の NAV に直結するため、逆方向（ARM→SBG, lag<0）が
強く出るはず。両方向のラグを必ず確認する。

usage: python scripts/validate_pairs.py [--markdown docs/VALIDATION.md]
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.conditional import conditional_stats
from app.analysis.lag_correlation import analyze_pair
from app.analysis.pricing_in import pricing_in_summary
from app.analysis.returns import daily_returns
from app.config import load_config
from app.data.cache import PriceCache
from app.data.service import DataService
from app.data.yfinance_source import YFinanceSource

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "prices.db"

PAIRS = [
    ("000660.KS", "MU", "SK hynix ↔ Micron"),
    ("9984.T", "ARM", "ソフトバンクG ↔ Arm"),
    ("ASML.AS", "AMAT", "ASML ↔ Applied Materials"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--markdown", type=Path, default=None)
    parser.add_argument("--years", type=float, default=2.0)
    args = parser.parse_args()

    cfg = load_config()
    svc = DataService(sources=[YFinanceSource()], cache=PriceCache(DB_PATH))
    start = date.today() - timedelta(days=int(args.years * 365))

    spx, _ = svc.get_daily(cfg.benchmark.symbol, start)
    spx_ret = daily_returns(spx["close"])

    lines = [f"# 3ペア検証結果（過去{args.years:.0f}年: {start} 〜 {date.today()}）", ""]
    for asia, us, label in PAIRS:
        a_df, a_stale = svc.get_daily(asia, start)
        u_df, u_stale = svc.get_daily(us, start)
        a_ret, u_ret = daily_returns(a_df["close"]), daily_returns(u_df["close"])

        lag = analyze_pair(asia, us, a_ret, u_ret, cfg.params)
        cond_all = conditional_stats(asia, us, a_ret, u_df, spx_ret, cfg.params, "all")
        cond_up = conditional_stats(asia, us, a_ret, u_df, spx_ret, cfg.params, "up")
        cond_dn = conditional_stats(asia, us, a_ret, u_df, spx_ret, cfg.params, "down")
        pricing = pricing_in_summary(a_ret, u_df, cfg.params)

        lines += [f"## {label}（{asia} → {us}）", "",
                  f"- 共通営業日数: {lag.n_obs}" + ("（stale データ含む）" if a_stale or u_stale else ""),
                  "", "### ラグ別相関 corr(アジア(t), 米国(t+lag))", "",
                  "| lag | " + " | ".join(str(k) for k in sorted(lag.by_lag)) + " |",
                  "|---|" + "---|" * len(lag.by_lag),
                  "| corr | " + " | ".join(
                      f"{v:.3f}" if v == v else "-" for _, v in sorted(lag.by_lag.items())) + " |",
                  "",
                  "lag=0 が同一カレンダー日（アジア引け→同日米国セッション）、"
                  "lag<0 は米国先行（米国→アジア方向）。", ""]

        for w, series in lag.rolling.items():
            if series:
                vals = [p["corr"] for p in series]
                lines.append(f"- ローリング{w}日相関: 直近 {vals[-1]:.3f} / "
                             f"最小 {min(vals):.3f} / 最大 {max(vals):.3f}")
        lines += ["", f"### 条件付き分析（±{cfg.params.sigma_threshold}σ トリガー日）", "",
                  "| 方向 | n | ヒット率 | ベースライン | 平均米国リターン | 平均ギャップ(織込) | 平均寄→引(残余) | 平均固有(β調整) |",
                  "|---|---|---|---|---|---|---|---|"]
        for c in (cond_all, cond_up, cond_dn):
            def fmt(v, pct=True):
                return ("-" if v is None else (f"{v:+.2%}" if pct else f"{v:.0%}"))
            lines.append(
                f"| {c.direction} | {c.n_trigger_days} | {fmt(c.hit_rate, False)} "
                f"| {fmt(c.baseline_hit_rate, False)} | {fmt(c.mean_us_return)} "
                f"| {fmt(c.mean_gap)} | {fmt(c.mean_open_to_close)} | {fmt(c.mean_us_residual)} |")
        if pricing.get("n"):
            lines += ["", "### 織り込み度（トリガー日、アジア方向に符号調整済み）", "",
                      f"- 平均トータル: {pricing['mean_directed_total']:+.2%} / "
                      f"うちギャップ: {pricing['mean_directed_gap']:+.2%} / "
                      f"寄り後残余: {pricing['mean_directed_open_to_close']:+.2%}",
                      f"- ギャップ比率の中央値: "
                      + (f"{pricing['median_gap_ratio']:.0%}" if pricing.get('median_gap_ratio') is not None else "-"),
                      f"- 残余がプラスだった割合: {pricing['pct_positive_residual']:.0%}"]
        lines.append("")

    report = "\n".join(lines)
    print(report)
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(report + "\n", encoding="utf-8")
        print(f"\nwritten to {args.markdown}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
