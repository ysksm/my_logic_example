"""ウォッチリスト全銘柄の取得・キャッシュ確認。

usage: python scripts/fetch_all.py [--years 2]
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import load_config
from app.data.cache import PriceCache
from app.data.service import DataService
from app.data.yfinance_source import YFinanceSource

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "prices.db"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=float, default=2.5)
    args = parser.parse_args()

    cfg = load_config()
    svc = DataService(sources=[YFinanceSource()], cache=PriceCache(DB_PATH))
    start = date.today() - timedelta(days=int(args.years * 365))

    results = svc.refresh_all(cfg.all_symbols(), start)
    failed = 0
    for r in results:
        status = "NG" if r.get("error") or r["rows"] == 0 else ("stale" if r["stale"] else "OK")
        if status == "NG":
            failed += 1
        print(f"{status:5s} {r['symbol']:12s} rows={r['rows']:5d} last={r.get('last')}"
              + (f" error={r['error'][:60]}" if r.get("error") else ""))
    print(f"\n{len(results) - failed}/{len(results)} symbols cached -> {DB_PATH}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
