"""モデル別の概算料金（USD / 100万トークン）。

公開されている Anthropic の料金を元にした目安です。実際の請求と細部が
異なる場合があるため、必要に応じて値を書き換えてください。マッチングは
モデルIDの部分一致（先に書いたものが優先）で行います。
"""

from __future__ import annotations

# (input, output, cache_read, cache_write_5m)  単位: USD / 1M tokens
PRICING: list[tuple[str, dict[str, float]]] = [
    ("opus",   {"input": 15.0, "output": 75.0, "cache_read": 1.50, "cache_write": 18.75}),
    ("sonnet", {"input": 3.0,  "output": 15.0, "cache_read": 0.30, "cache_write": 3.75}),
    ("haiku-3",{"input": 0.25, "output": 1.25, "cache_read": 0.03, "cache_write": 0.30}),
    ("haiku",  {"input": 0.80, "output": 4.00, "cache_read": 0.08, "cache_write": 1.00}),
    ("fable",  {"input": 3.0,  "output": 15.0, "cache_read": 0.30, "cache_write": 3.75}),
]

_ZERO = {"input": 0.0, "output": 0.0, "cache_read": 0.0, "cache_write": 0.0}


def rates_for(model: str | None) -> dict[str, float]:
    """モデルIDに対応する単価を返す。未知のモデルは 0（コスト不明）。"""
    if not model:
        return _ZERO
    m = model.lower()
    for key, rates in PRICING:
        if key in m:
            return rates
    return _ZERO


def cost_usd(model: str | None, input_t: int, output_t: int,
             cache_read_t: int, cache_write_t: int) -> float:
    """トークン数から概算コスト（USD）を計算する。"""
    r = rates_for(model)
    return (
        input_t      / 1_000_000 * r["input"]
        + output_t     / 1_000_000 * r["output"]
        + cache_read_t / 1_000_000 * r["cache_read"]
        + cache_write_t/ 1_000_000 * r["cache_write"]
    )


def is_known(model: str | None) -> bool:
    return rates_for(model) is not _ZERO
