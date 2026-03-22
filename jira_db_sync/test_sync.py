"""
CLI テストスクリプト: marimo を起動せずに同期ロジックをテストする。

使い方:
    uv run python test_sync.py                     # デフォルトプロジェクト, 5件テスト
    uv run python test_sync.py TODO                # TODO プロジェクト, 5件テスト
    uv run python test_sync.py TODO --full         # TODO プロジェクト, 全件同期
    uv run python test_sync.py TODO --limit 20     # TODO プロジェクト, 20件テスト
    uv run python test_sync.py --list              # プロジェクト一覧のみ表示
"""

import argparse
import json
import os
import sys
import time
import traceback
from base64 import b64encode
from datetime import datetime, timezone

import duckdb
import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv(override=False)


# ============================================================
# 設定
# ============================================================
JIRA_BASE_URL = os.environ.get("JIRA_BASE_URL", "")
JIRA_USERNAME = os.environ.get("JIRA_USERNAME", "")
JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN", "")
JIRA_DB_PATH = os.environ.get("JIRA_DB_PATH", "./data/jira.duckdb")

if not all([JIRA_BASE_URL, JIRA_USERNAME, JIRA_API_TOKEN]):
    print("ERROR: JIRA_BASE_URL, JIRA_USERNAME, JIRA_API_TOKEN を設定してください")
    sys.exit(1)

_cred = f"{JIRA_USERNAME}:{JIRA_API_TOKEN}"
HEADERS = {
    "Authorization": f"Basic {b64encode(_cred.encode()).decode()}",
    "Accept": "application/json",
}


# ============================================================
# ヘルパー
# ============================================================
def jira_get(path, params=None, max_retries=3):
    url = f"{JIRA_BASE_URL}/rest/api/3/{path}"
    for attempt in range(max_retries + 1):
        resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
        if resp.status_code == 429:
            time.sleep(int(resp.headers.get("Retry-After", 2 ** (attempt + 1))))
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()
    return {}


def safe_str(val):
    if val is None or (isinstance(val, float) and val != val):
        return ""
    return str(val).lower()


def safe_json(val):
    if val is None:
        return None
    return json.dumps(val, ensure_ascii=False)


def step(name):
    print(f"\n{'='*60}\n  {name}\n{'='*60}")


def ok(msg):
    print(f"  OK: {msg}")


def fail(msg):
    print(f"  FAIL: {msg}")


# ============================================================
# メイン
# ============================================================
def main():
    parser = argparse.ArgumentParser(description="Jira DB Sync テスト")
    parser.add_argument("project", nargs="?", default=None, help="プロジェクトキー (例: TODO)")
    parser.add_argument("--full", action="store_true", help="全件同期 (デフォルトは5件テスト)")
    parser.add_argument("--limit", type=int, default=5, help="テスト件数 (デフォルト: 5)")
    parser.add_argument("--list", action="store_true", help="プロジェクト一覧のみ表示")
    parser.add_argument("--db", default=None, help="DB パス (デフォルト: テスト用一時DB)")
    args = parser.parse_args()

    # ----------------------------------------------------------
    # 1. プロジェクト一覧
    # ----------------------------------------------------------
    step("1. プロジェクト一覧")
    projects_raw = jira_get("project")
    projects_list = [
        {"id": p["id"], "key": p["key"], "name": p["name"],
         "description": p.get("description", ""), "raw_data": p}
        for p in projects_raw
    ]
    for p in projects_list:
        print(f"  {p['key']:10s} ({p['id']}) {p['name']}")

    if args.list:
        return

    selected = args.project or os.environ.get("JIRA_PROJECT") or projects_list[0]["key"]
    print(f"\n  選択: {selected}")

    # ----------------------------------------------------------
    # 2. メタデータ
    # ----------------------------------------------------------
    step("2. フィールド定義")
    fields_raw = jira_get("field")
    fields_df = pd.DataFrame([
        {
            "id": f.get("id", ""),
            "key": f.get("key", f.get("id", "")),
            "name": f.get("name", ""),
            "custom": f.get("custom", False),
            "searchable": f.get("searchable", False),
            "navigable": f.get("navigable", False),
            "orderable": f.get("orderable", False),
            "schema_type": (f.get("schema") or {}).get("type"),
            "schema_items": (f.get("schema") or {}).get("items"),
            "schema_system": (f.get("schema") or {}).get("system"),
            "schema_custom": (f.get("schema") or {}).get("custom"),
            "schema_custom_id": (f.get("schema") or {}).get("customId"),
        }
        for f in fields_raw
    ])
    ok(f"{len(fields_df)} 件 (navigable: {fields_df['navigable'].sum()}, custom: {fields_df['custom'].sum()})")

    # ----------------------------------------------------------
    # 3. Issues 取得
    # ----------------------------------------------------------
    max_results = 1000 if args.full else args.limit
    step(f"3. Issues 取得 ({'全件' if args.full else f'{max_results}件テスト'})")

    jql = f"project = {selected} ORDER BY updated ASC, key ASC"
    all_issues = []
    page_token = None
    while True:
        params = {
            "jql": jql, "fields": "*navigable,created,updated",
            "expand": "changelog", "maxResults": str(max_results),
        }
        if page_token:
            params["nextPageToken"] = page_token
        data = jira_get("search/jql", params=params)
        issues = data.get("issues", [])
        all_issues.extend(issues)
        next_token = data.get("nextPageToken")
        is_last = data.get("isLast", True)
        print(f"  バッチ: {len(issues)} 件, 合計: {len(all_issues)} 件, isLast={is_last}")
        if not args.full or (is_last is True or is_last is None) and not next_token:
            break
        if not next_token:
            break
        page_token = next_token
    ok(f"取得: {len(all_issues)} 件")

    # ----------------------------------------------------------
    # 4. DataFrame 作成
    # ----------------------------------------------------------
    step("4. issues_df 作成")
    issues_data = []
    for iss in all_issues:
        f = iss.get("fields", {})
        issues_data.append({
            "id": iss["id"], "key": iss["key"],
            "project_id": f.get("project", {}).get("id", ""),
            "summary": f.get("summary", ""),
            "description": f.get("description"),
            "status": (f.get("status") or {}).get("name"),
            "priority": (f.get("priority") or {}).get("name"),
            "assignee": (f.get("assignee") or {}).get("displayName"),
            "reporter": (f.get("reporter") or {}).get("displayName"),
            "issue_type": (f.get("issuetype") or {}).get("name"),
            "resolution": (f.get("resolution") or {}).get("name"),
            "labels": safe_json(f.get("labels")),
            "components": safe_json([c["name"] for c in (f.get("components") or []) if "name" in c]),
            "fix_versions": safe_json([v["name"] for v in (f.get("fixVersions") or []) if "name" in v]),
            "sprint": None, "parent_key": (f.get("parent") or {}).get("key"),
            "due_date": f.get("duedate"),
            "created_date": f.get("created"), "updated_date": f.get("updated"),
            "raw_data": json.dumps(iss, ensure_ascii=False),
        })
    issues_df = pd.DataFrame(issues_data)
    ok(f"{len(issues_df)} rows, {len(issues_df.columns)} cols: {list(issues_df.columns)}")

    # テーブルのカラム順に並べ替え
    _tbl_col_order = [
        "id", "project_id", "key", "summary", "description",
        "status", "priority", "assignee", "reporter", "issue_type",
        "resolution", "labels", "components", "fix_versions", "sprint",
        "parent_key", "due_date", "created_date", "updated_date", "raw_data",
    ]
    issues_df = issues_df[_tbl_col_order]
    ok(f"カラム順序を合わせました: {list(issues_df.columns)}")

    # ----------------------------------------------------------
    # 5. DuckDB 同期
    # ----------------------------------------------------------
    use_test_db = args.db is None
    db_path = args.db or "./data/_test_sync.duckdb"
    step(f"5. DuckDB 同期 ({db_path})")
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    if use_test_db and os.path.exists(db_path):
        os.remove(db_path)

    conn = duckdb.connect(db_path)
    ddl = [
        """CREATE TABLE IF NOT EXISTS projects (
            id VARCHAR PRIMARY KEY, "key" VARCHAR NOT NULL, name VARCHAR NOT NULL,
            description TEXT, raw_data JSON,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""",
        """CREATE TABLE IF NOT EXISTS issues (
            id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL,
            "key" VARCHAR NOT NULL, summary TEXT NOT NULL, description TEXT,
            status VARCHAR, priority VARCHAR, assignee VARCHAR, reporter VARCHAR,
            issue_type VARCHAR, resolution VARCHAR, labels JSON, components JSON,
            fix_versions JSON, sprint VARCHAR, parent_key VARCHAR,
            due_date VARCHAR, created_date VARCHAR, updated_date VARCHAR,
            raw_data JSON, synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""",
        """CREATE TABLE IF NOT EXISTS issue_change_history (
            issue_id VARCHAR NOT NULL, issue_key VARCHAR NOT NULL,
            history_id VARCHAR NOT NULL, author_account_id VARCHAR,
            author_display_name VARCHAR, field VARCHAR NOT NULL,
            field_type VARCHAR, from_value TEXT, from_string TEXT,
            to_value TEXT, to_string TEXT, changed_at VARCHAR NOT NULL)""",
    ]
    for sql in ddl:
        conn.execute(sql)
    ok("スキーマ作成")

    # projects
    for p in projects_list:
        conn.execute(
            """INSERT INTO projects (id, "key", name, description, raw_data)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                "key" = EXCLUDED."key", name = EXCLUDED.name,
                description = EXCLUDED.description, raw_data = EXCLUDED.raw_data""",
            [p["id"], p["key"], p["name"], p["description"],
             json.dumps(p["raw_data"], ensure_ascii=False)],
        )
    ok(f"projects: {conn.execute('SELECT COUNT(*) FROM projects').fetchone()[0]} 件")

    # issues
    conn.execute(f'DELETE FROM issues WHERE "key" LIKE \'{selected}-%\'')
    conn.execute("INSERT INTO issues SELECT *, CURRENT_TIMESTAMP FROM issues_df")
    _count = conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0]
    _key_match = conn.execute(f"""SELECT COUNT(*) FROM issues WHERE "key" LIKE '{selected}-%'""").fetchone()[0]
    ok(f"issues: {_count} 件 (key LIKE '{selected}-%': {_key_match})")

    # change_history
    ch_rows = []
    for iss in all_issues:
        for hist in iss.get("changelog", {}).get("histories", []):
            for item in hist.get("items", []):
                ch_rows.append({
                    "issue_id": iss["id"], "issue_key": iss["key"],
                    "history_id": hist.get("id", ""),
                    "author_account_id": hist.get("author", {}).get("accountId"),
                    "author_display_name": hist.get("author", {}).get("displayName"),
                    "field": item.get("field", ""), "field_type": item.get("fieldtype"),
                    "from_value": item.get("from"), "from_string": item.get("fromString"),
                    "to_value": item.get("to"), "to_string": item.get("toString"),
                    "changed_at": hist.get("created", ""),
                })
    if ch_rows:
        ch_df = pd.DataFrame(ch_rows)
        conn.execute(f'DELETE FROM issue_change_history WHERE issue_key LIKE \'{selected}-%\'')
        conn.execute("INSERT INTO issue_change_history SELECT * FROM ch_df")
    ok(f"change_history: {conn.execute('SELECT COUNT(*) FROM issue_change_history').fetchone()[0]} 件")

    # ----------------------------------------------------------
    # 6. issues_expanded
    # ----------------------------------------------------------
    step("6. issues_expanded")

    target_fields = fields_df[fields_df["navigable"] == True].to_dict("records")
    ok(f"対象フィールド: {len(target_fields)} 件")

    def to_col_type(schema_type, schema_items):
        st = safe_str(schema_type)
        if st in ("number", "numeric"): return "DOUBLE"
        elif st == "datetime": return "TIMESTAMPTZ"
        elif st == "date": return "DATE"
        elif st in ("array", "any"): return "JSON"
        return "VARCHAR"

    def to_select_expr(fid, schema_type, schema_items, schema_system):
        st = safe_str(schema_type)
        if st == "user": return f"i.raw_data->'fields'->'{fid}'->>'displayName'"
        elif st in ("status","priority","resolution","issuetype","securitylevel","component","version"):
            return f"i.raw_data->'fields'->'{fid}'->>'name'"
        elif st in ("option","option-with-child"):
            return f"COALESCE(i.raw_data->'fields'->'{fid}'->>'value',i.raw_data->'fields'->'{fid}'->>'name')"
        elif st == "array": return f"TRY_CAST(i.raw_data->'fields'->'{fid}' AS JSON)"
        elif st == "number": return f"TRY_CAST(i.raw_data->'fields'->>'{fid}' AS DOUBLE)"
        elif st in ("datetime","date"): return f"TRY_CAST(i.raw_data->'fields'->>'{fid}' AS TIMESTAMP)"
        elif st in ("progress","any"): return f"TRY_CAST(i.raw_data->'fields'->'{fid}' AS JSON)"
        elif st == "string": return f"i.raw_data->'fields'->>'{fid}'"
        else:
            return (f"COALESCE(i.raw_data->'fields'->'{fid}'->>'name',"
                    f"i.raw_data->'fields'->'{fid}'->>'value',"
                    f"i.raw_data->'fields'->'{fid}'->>'displayName',"
                    f"i.raw_data->'fields'->>'{fid}')")

    select_parts = [
        "i.id", "i.project_id",
        """COALESCE(i.raw_data->>'key', i."key") AS issue_key""",
    ]
    col_defs = [("id","VARCHAR PRIMARY KEY"),("project_id","VARCHAR NOT NULL"),("issue_key","VARCHAR NOT NULL")]
    processed = {"id","project_id","issue_key"}

    for f in target_fields:
        fid = f["id"]
        col = fid.lower().replace("-","_").replace(".","_")
        if col in processed: continue
        processed.add(col)
        ct = to_col_type(f.get("schema_type"), f.get("schema_items"))
        expr = to_select_expr(fid, f.get("schema_type"), f.get("schema_items"), f.get("schema_system"))
        select_parts.append(f'{expr} AS "{col}"')
        col_defs.append((col, ct))

    select_parts.append("CURRENT_TIMESTAMP AS synced_at")
    col_defs.append(("synced_at","TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP"))
    ok(f"カラム定義: {len(col_defs)} 個")

    conn.execute("DROP TABLE IF EXISTS issues_expanded")
    create_cols = ", ".join(f'"{c}" {t}' for c,t in col_defs)
    conn.execute(f"CREATE TABLE issues_expanded ({create_cols})")
    ok("テーブル作成")

    select_sql = ",\n        ".join(select_parts)
    insert_sql = f"""
        INSERT INTO issues_expanded
        SELECT {select_sql}
        FROM issues i
        WHERE i."key" LIKE '{selected}-%'
    """
    try:
        conn.execute(insert_sql)
        expanded = conn.execute("SELECT COUNT(*) FROM issues_expanded").fetchone()[0]
        ok(f"展開: {expanded} 件")
    except Exception as e:
        fail(f"{e}")
        print(f"\n  SQL (先頭1000文字):\n{insert_sql[:1000]}")
        traceback.print_exc()
        conn.close()
        sys.exit(1)

    # issues_readable ビュー
    fm = dict(zip(fields_df["id"].str.lower(), fields_df["name"]))
    fm.update({"id": "ID", "project_id": "Project ID", "issue_key": "Key", "synced_at": "同期日時"})
    vc = []
    for col, _ in col_defs:
        d = fm.get(col, col).replace('"', '""')
        vc.append(f'"{col}" AS "{d}"')
    conn.execute(f"CREATE OR REPLACE VIEW issues_readable AS SELECT {','.join(vc)} FROM issues_expanded")
    ok(f"issues_readable ビュー: {conn.execute('SELECT COUNT(*) FROM issues_readable').fetchone()[0]} 件")

    # サンプル
    if expanded > 0:
        sample = conn.execute('SELECT "id","issue_key","summary","status" FROM issues_expanded LIMIT 5').fetchdf()
        print(f"\n  サンプル:\n{sample.to_string(index=False)}")

    # ----------------------------------------------------------
    # 7. 可視化クエリ検証
    # ----------------------------------------------------------
    step("7. 可視化クエリ検証")

    _viz_queries = {
        "ステータス別": 'SELECT status, COUNT(*) as count FROM issues GROUP BY status ORDER BY count DESC',
        "優先度別": 'SELECT priority, COUNT(*) as count FROM issues WHERE priority IS NOT NULL GROUP BY priority',
        "課題タイプ別": 'SELECT issue_type, COUNT(*) as count FROM issues WHERE issue_type IS NOT NULL GROUP BY issue_type',
        "担当者別": "SELECT COALESCE(assignee, '未割当') as assignee, COUNT(*) as count FROM issues GROUP BY assignee ORDER BY count DESC LIMIT 15",
        "月別作成数": "SELECT STRFTIME(CAST(created_date AS TIMESTAMP), '%Y-%m') as month, COUNT(*) as count FROM issues WHERE created_date IS NOT NULL GROUP BY month ORDER BY month",
        "フィールド別変更回数": 'SELECT field, COUNT(*) as count FROM issue_change_history GROUP BY field ORDER BY count DESC LIMIT 10',
        "ステータス遷移": "SELECT COALESCE(from_string, '(新規)') as from_status, to_string as to_status, COUNT(*) as count FROM issue_change_history WHERE field = 'status' AND to_string IS NOT NULL GROUP BY from_status, to_status",
    }

    _all_ok = True
    for _name, _sql in _viz_queries.items():
        try:
            _result = conn.execute(_sql).fetchdf()
            if _result.empty:
                fail(f"{_name}: 0件 (データなし)")
                _all_ok = False
            else:
                ok(f"{_name}: {len(_result)} 件")
        except Exception as _e:
            fail(f"{_name}: {_e}")
            _all_ok = False

    # issues_readable ビュー
    try:
        _rv = conn.execute("SELECT COUNT(*) FROM issues_readable").fetchone()[0]
        ok(f"issues_readable ビュー: {_rv} 件")
    except Exception as _e:
        fail(f"issues_readable ビュー: {_e}")
        _all_ok = False

    # ----------------------------------------------------------
    # 8. 依存関係チェック (marimo 固有の問題検出)
    # ----------------------------------------------------------
    step("8. marimo 依存関係チェック")

    import ast
    with open("marimo_main.py") as _mf:
        _tree = ast.parse(_mf.read())

    _cell_vars = []
    for _node in ast.walk(_tree):
        if isinstance(_node, ast.FunctionDef) and _node.name == "_":
            # セルの引数（依存変数）を取得
            _args = [a.arg for a in _node.args.args]
            # return 文から公開変数を取得
            _returns = []
            for _child in ast.walk(_node):
                if isinstance(_child, ast.Return) and _child.value:
                    if isinstance(_child.value, ast.Tuple):
                        for _elt in _child.value.elts:
                            if isinstance(_elt, ast.Name):
                                _returns.append(_elt.id)
                    elif isinstance(_child.value, ast.Name):
                        _returns.append(_child.value.id)
            _cell_vars.append({"args": _args, "returns": _returns, "line": _node.lineno})

    # conn を使うセルが sync_completed/expand_completed に依存しているか確認
    _conn_cells_without_signal = []
    for _cv in _cell_vars:
        if "conn" in _cv["args"]:
            # 直接または間接的に sync_completed/expand_completed に依存しているか
            _signal_vars = {
                "sync_completed", "expand_completed", "sync_mode",
                "alt",  # alt ← expand_completed 経由
                "snapshot_df", "snapshot_date_picker",  # ← expand_completed 経由
            }
            _has_signal = bool(_signal_vars & set(_cv["args"]))
            # DB スキーマセル自身は除外
            if "duckdb" in _cv["args"]:
                continue
            if not _has_signal:
                _conn_cells_without_signal.append(_cv["line"])

    if _conn_cells_without_signal:
        fail(f"conn を使うが同期完了シグナルに依存していないセル: 行 {_conn_cells_without_signal}")
        _all_ok = False
    else:
        ok("全ての conn 使用セルが同期完了シグナルに依存しています")

    conn.close()
    if use_test_db:
        os.remove(db_path)
        _wal = db_path + ".wal"
        if os.path.exists(_wal):
            os.remove(_wal)

    step("全テスト完了")
    if not _all_ok:
        print("  WARN: 一部のテストが失敗しています")
        sys.exit(1)


if __name__ == "__main__":
    main()
