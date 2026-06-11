"""日次シグナル実行 CLI。アジア・欧州引け後（JST 夕方〜夜）に実行する想定。

usage: python scripts/daily_signal.py [--no-refresh] [--no-premarket] [--date YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import load_config
from app.data.cache import PriceCache
from app.data.service import DataService
from app.data.yfinance_source import YFinanceSource
from app.signals.engine import SignalEngine

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "prices.db"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-refresh", action="store_true")
    parser.add_argument("--no-premarket", action="store_true")
    parser.add_argument("--date", type=date.fromisoformat, default=None)
    parser.add_argument("--json", action="store_true", help="JSON で出力")
    args = parser.parse_args()

    cfg = load_config()
    engine = SignalEngine(cfg, DataService(sources=[YFinanceSource()], cache=PriceCache(DB_PATH)))
    result = engine.run(as_of=args.date, refresh=not args.no_refresh,
                        with_premarket=not args.no_premarket)

    if args.json:
        result["signals"] = [asdict(s) for s in result["signals"]]
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(f"=== {result['as_of']} シグナルレポート: {result['summary']} ===\n")
    if not result["signals"]:
        print(f"±{cfg.params.sigma_threshold}σ 以上動いたウォッチ銘柄はありません。")
    for s in result["signals"]:
        pm = f" / プレマーケット {s.premarket_move:+.2%}" if s.premarket_move is not None else ""
        print(f"[{s.strength.upper():8s}] {s.layer_name}: {s.asia_name}({s.asia_symbol}) "
              f"{s.asia_return:+.2%} ({s.asia_sigma:+.1f}σ) → {s.us_name}({s.us_symbol}){pm}")
        print(f"           根拠: {s.rationale}")
    if result["errors"]:
        print("\n-- 取得エラー --")
        for e in result["errors"]:
            print(f"  {e['symbol']}: {e['error'][:100]}")
    print("\n※ 本レポートは統計的根拠の提示であり、売買推奨ではありません。最終判断はご自身で。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
