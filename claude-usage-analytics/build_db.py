"""Claude Code のセッション履歴(JSONL) を DuckDB に変換する ETL。

~/.claude/projects/**/*.jsonl を走査し、次の3テーブルを持つ DuckDB ファイルを作る:

  - events      : 1行 = JSONL の1エントリ（user/assistant/system/...）。トークン・コスト付き。
  - tool_calls  : 1行 = ツール呼び出し1回。実行結果・wall-clock 実行時間・エラー有無付き。
  - prompts     : 1行 = 人間のプロンプト1回（テキスト・文字数）。

使い方:
  uv run python build_db.py                 # ~/.claude から ./claude_usage.duckdb を生成
  uv run python build_db.py --source DIR --out PATH.duckdb
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

import duckdb
import polars as pl

import pricing


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def text_len_of(content) -> tuple[int, int, int]:
    """content から (text文字数, thinking文字数, tool_useの数) を返す。"""
    if content is None:
        return 0, 0, 0
    if isinstance(content, str):
        return len(content), 0, 0
    text = thinking = tools = 0
    if isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "text":
                text += len(b.get("text") or "")
            elif t == "thinking":
                thinking += len(b.get("thinking") or "")
            elif t == "tool_use":
                tools += 1
    return text, thinking, tools


def stringify(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    try:
        return json.dumps(v, ensure_ascii=False)
    except Exception:
        return str(v)


def result_text_len(content) -> int:
    if content is None:
        return 0
    if isinstance(content, str):
        return len(content)
    if isinstance(content, list):
        n = 0
        for b in content:
            if isinstance(b, dict):
                n += len(b.get("text") or "")
            elif isinstance(b, str):
                n += len(b)
        return n
    return len(stringify(content))


def find_jsonl(source: Path) -> list[Path]:
    proj = source / "projects" if (source / "projects").is_dir() else source
    return sorted(proj.rglob("*.jsonl"))


def build(source: Path, out: Path) -> dict:
    files = find_jsonl(source)
    events: list[dict] = []
    tool_use_rows: list[dict] = []   # 呼び出し側
    results: dict[str, dict] = {}    # tool_use_id -> 結果
    prompts: list[dict] = []

    for fp in files:
        is_subagent = "subagents" in fp.parts
        try:
            lines = fp.read_text(errors="replace").splitlines()
        except Exception:
            continue
        for raw in lines:
            raw = raw.strip()
            if not raw:
                continue
            try:
                o = json.loads(raw)
            except Exception:
                continue
            typ = o.get("type", "?")
            msg = o.get("message") if isinstance(o.get("message"), dict) else {}
            usage = msg.get("usage") if isinstance(msg.get("usage"), dict) else {}
            ts = parse_ts(o.get("timestamp"))
            cwd = o.get("cwd") or ""
            project = os.path.basename(cwd.rstrip("/")) if cwd else "(unknown)"
            content = msg.get("content")
            tlen, thlen, ntools = text_len_of(content)

            in_t = int(usage.get("input_tokens") or 0)
            out_t = int(usage.get("output_tokens") or 0)
            cr_t = int(usage.get("cache_read_input_tokens") or 0)
            cw_t = int(usage.get("cache_creation_input_tokens") or 0)
            model = msg.get("model")
            cost = pricing.cost_usd(model, in_t, out_t, cr_t, cw_t) if typ == "assistant" else 0.0

            events.append({
                "source_file": str(fp),
                "is_subagent": is_subagent,
                "session_id": o.get("sessionId"),
                "uuid": o.get("uuid"),
                "parent_uuid": o.get("parentUuid"),
                "type": typ,
                "subtype": o.get("subtype"),
                "role": msg.get("role"),
                "timestamp": ts,
                "cwd": cwd,
                "project": project,
                "git_branch": o.get("gitBranch"),
                "version": o.get("version"),
                "entrypoint": o.get("entrypoint"),
                "user_type": o.get("userType"),
                "is_sidechain": bool(o.get("isSidechain")),
                "request_id": o.get("requestId"),
                "model": model,
                "stop_reason": msg.get("stop_reason"),
                "service_tier": usage.get("service_tier"),
                "input_tokens": in_t,
                "output_tokens": out_t,
                "cache_read_tokens": cr_t,
                "cache_creation_tokens": cw_t,
                "cost_usd": cost,
                "text_len": tlen,
                "thinking_len": thlen,
                "n_tool_use": ntools,
            })

            # assistant の tool_use ブロック -> 呼び出し
            if typ == "assistant" and isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        tin = b.get("input")
                        tool_use_rows.append({
                            "tool_use_id": b.get("id"),
                            "session_id": o.get("sessionId"),
                            "project": project,
                            "is_subagent": is_subagent,
                            "model": model,
                            "tool_name": b.get("name"),
                            "call_ts": ts,
                            "input_chars": len(stringify(tin)),
                            "input_json": stringify(tin),
                        })

            # user の tool_result ブロック + toolUseResult -> 結果
            if typ == "user" and isinstance(content, list):
                tur = o.get("toolUseResult")
                tur_str = stringify(tur)
                # toolUseResult からエラー兆候を推定
                tur_error = isinstance(tur, str) and tur.lower().startswith("error")
                tur_interrupted = isinstance(tur, dict) and bool(tur.get("interrupted"))
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        tid = b.get("tool_use_id")
                        if not tid:
                            continue
                        is_err = b.get("is_error")
                        results[tid] = {
                            "result_ts": ts,
                            "is_error": bool(is_err) or tur_error or tur_interrupted,
                            "result_chars": result_text_len(b.get("content")),
                            "tool_use_result": tur_str[:20000],
                        }

            # 人間のプロンプト（tool_result でない user メッセージ）
            if typ == "user" and not is_subagent:
                is_tool_result = isinstance(content, list) and any(
                    isinstance(b, dict) and b.get("type") == "tool_result" for b in content
                )
                if not is_tool_result:
                    if isinstance(content, str):
                        text = content
                    else:
                        text = " ".join(
                            b.get("text", "") for b in (content or [])
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    if text.strip():
                        prompts.append({
                            "session_id": o.get("sessionId"),
                            "project": project,
                            "timestamp": ts,
                            "git_branch": o.get("gitBranch"),
                            "char_len": len(text),
                            "word_len": len(text.split()),
                            "text": text[:4000],
                        })

    # tool_calls = 呼び出し + 結果 を結合し wall-clock 実行時間を計算
    tool_rows: list[dict] = []
    for c in tool_use_rows:
        r = results.get(c["tool_use_id"], {})
        call_ts = c["call_ts"]
        res_ts = r.get("result_ts")
        dur = None
        if call_ts and res_ts:
            dur = (res_ts - call_ts).total_seconds() * 1000.0
        tool_rows.append({
            **c,
            "result_ts": res_ts,
            "duration_ms": dur,
            "is_error": r.get("is_error", False),
            "result_chars": r.get("result_chars", 0),
            "tool_use_result": r.get("tool_use_result", ""),
        })

    # DuckDB へ書き出し
    if out.exists():
        out.unlink()
    con = duckdb.connect(str(out))

    def write(name: str, rows: list[dict]):
        if rows:
            df = pl.DataFrame(rows, infer_schema_length=None)
        else:
            df = pl.DataFrame()
        con.register("_tmp", df)
        con.execute(f"CREATE TABLE {name} AS SELECT * FROM _tmp")
        con.unregister("_tmp")

    write("events", events)
    write("tool_calls", tool_rows)
    write("prompts", prompts)

    # 便利ビュー
    con.execute("""
        CREATE VIEW sessions AS
        SELECT
            session_id,
            any_value(project) AS project,
            min(timestamp) AS started_at,
            max(timestamp) AS ended_at,
            date_diff('minute', min(timestamp), max(timestamp)) AS duration_min,
            count(*) FILTER (WHERE type='user' AND is_sidechain=false) AS user_turns,
            count(*) FILTER (WHERE type='assistant') AS assistant_msgs,
            sum(input_tokens) AS input_tokens,
            sum(output_tokens) AS output_tokens,
            sum(cache_read_tokens) AS cache_read_tokens,
            sum(cache_creation_tokens) AS cache_creation_tokens,
            sum(cost_usd) AS cost_usd
        FROM events
        GROUP BY session_id
    """)

    con.close()
    return {
        "files": len(files),
        "events": len(events),
        "tool_calls": len(tool_rows),
        "prompts": len(prompts),
    }


def main():
    ap = argparse.ArgumentParser(description="Claude Code セッション履歴を DuckDB に変換")
    ap.add_argument("--source", default=str(Path.home() / ".claude"),
                    help="~/.claude ディレクトリ (既定: $HOME/.claude)")
    ap.add_argument("--out", default="claude_usage.duckdb", help="出力 DuckDB ファイル")
    args = ap.parse_args()

    source = Path(os.path.expanduser(args.source))
    out = Path(args.out)
    if not source.exists():
        raise SystemExit(f"source が見つかりません: {source}")

    stats = build(source, out)
    print(f"✅ 生成完了: {out}")
    print(f"   files={stats['files']}  events={stats['events']}  "
          f"tool_calls={stats['tool_calls']}  prompts={stats['prompts']}")


if __name__ == "__main__":
    main()
