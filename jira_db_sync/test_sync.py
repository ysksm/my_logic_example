"""
CLI テストスクリプト: jira_sync ライブラリの全フローをテスト

使い方:
    uv run python test_sync.py                     # デフォルトプロジェクト
    uv run python test_sync.py TODO                # TODO プロジェクト
    uv run python test_sync.py TODO --full         # 全件同期
    uv run python test_sync.py --list              # プロジェクト一覧のみ
"""

import argparse
import os
import sys

import pandas as pd
from dotenv import load_dotenv

load_dotenv(override=False)


def step(name):
    print(f"\n{'='*60}\n  {name}\n{'='*60}")


def ok(msg):
    print(f"  OK: {msg}")


def fail(msg):
    print(f"  FAIL: {msg}")


def main():
    parser = argparse.ArgumentParser(description="Jira DB Sync テスト")
    parser.add_argument("project", nargs="?", default=None)
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--db", default=None)
    args = parser.parse_args()

    from jira_sync import JiraClient, Database, SyncService, FieldExpander
    from jira_sync.sync import SyncState

    base_url = os.environ.get("JIRA_BASE_URL", "")
    username = os.environ.get("JIRA_USERNAME", "")
    token = os.environ.get("JIRA_API_TOKEN", "")
    if not all([base_url, username, token]):
        print("ERROR: JIRA_BASE_URL, JIRA_USERNAME, JIRA_API_TOKEN を設定してください")
        sys.exit(1)

    # 1. クライアント初期化
    step("1. 初期化")
    client = JiraClient(base_url, username, token)
    ok("JiraClient")

    # 2. プロジェクト一覧
    step("2. プロジェクト一覧")
    projects_raw = client.fetch_projects()
    projects = [{"id": p["id"], "key": p["key"], "name": p["name"],
                 "description": p.get("description", ""), "raw_data": p}
                for p in projects_raw]
    for p in projects:
        print(f"  {p['key']:10s} ({p['id']}) {p['name']}")
    if args.list:
        return

    selected = args.project or os.environ.get("JIRA_PROJECT") or projects[0]["key"]
    ok(f"選択: {selected}")

    # 3. メタデータ
    step("3. メタデータ")
    statuses = client.fetch_project_statuses(selected)
    ok(f"ステータス: {len(statuses)}")
    priorities = client.fetch_priorities()
    priorities_df = pd.DataFrame(priorities)
    ok(f"優先度: {len(priorities_df)}")

    _proj_id = next((p["id"] for p in projects if p["key"] == selected), selected)
    issue_types = client.fetch_issue_types(_proj_id)
    issue_types_df = pd.DataFrame(issue_types) if issue_types else pd.DataFrame()
    ok(f"課題タイプ: {len(issue_types_df)}")

    fields_raw = client.fetch_fields()
    fields_df = pd.DataFrame([{
        "id": f.get("id", ""), "key": f.get("key", f.get("id", "")),
        "name": f.get("name", ""), "custom": f.get("custom", False),
        "searchable": f.get("searchable", False),
        "navigable": f.get("navigable", False),
        "orderable": f.get("orderable", False),
        "schema_type": (f.get("schema") or {}).get("type"),
        "schema_items": (f.get("schema") or {}).get("items"),
        "schema_system": (f.get("schema") or {}).get("system"),
        "schema_custom": (f.get("schema") or {}).get("custom"),
        "schema_custom_id": (f.get("schema") or {}).get("customId"),
    } for f in fields_raw])
    ok(f"フィールド: {len(fields_df)} (navigable: {fields_df['navigable'].sum()})")

    # 4. 同期実行
    use_test_db = args.db is None
    db_path = args.db or "./data/_test_sync.duckdb"
    step(f"4. 同期 ({db_path})")
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    if use_test_db and os.path.exists(db_path):
        os.remove(db_path)

    db = Database(db_path)
    sync_state = SyncState(db_path.replace(".duckdb", "_state.json"))
    svc = SyncService(client, db, sync_state)

    mode = "full" if args.full else "full"  # テストは常に full
    result = svc.execute(
        project_key=selected,
        mode=mode,
        projects=projects,
        statuses=statuses,
        priorities_df=priorities_df,
        issue_types_df=issue_types_df,
        fields_df=fields_df,
    )

    ok(f"取得: {result['fetched']} 件")
    ok(f"変更履歴: {result['history']} 件")
    ok(f"展開: {result['expanded'].get('expanded', 0)} 件, {result['expanded'].get('columns', 0)} カラム")
    ok(f"DB Issues: {result['summary']['issues']}, History: {result['summary']['history']}")

    # 5. 検証
    step("5. 検証")
    _all_ok = True

    # issues_expanded
    _exp = db.conn.execute("SELECT COUNT(*) FROM issues_expanded").fetchone()[0]
    if _exp > 0:
        ok(f"issues_expanded: {_exp} 件")
    else:
        fail("issues_expanded: 0件")
        _all_ok = False

    # issues_readable
    try:
        _rv = db.conn.execute("SELECT COUNT(*) FROM issues_readable").fetchone()[0]
        ok(f"issues_readable: {_rv} 件")
    except Exception as e:
        fail(f"issues_readable: {e}")
        _all_ok = False

    # key LIKE
    _km = db.conn.execute(f"""SELECT COUNT(*) FROM issues WHERE "key" LIKE '{selected}-%'""").fetchone()[0]
    if _km > 0:
        ok(f'key LIKE "{selected}-%": {_km} 件')
    else:
        fail(f'key LIKE "{selected}-%": 0 件')
        _all_ok = False

    # 可視化クエリ
    _queries = {
        "ステータス別": "SELECT status, COUNT(*) FROM issues GROUP BY status",
        "変更履歴": "SELECT field, COUNT(*) FROM issue_change_history GROUP BY field LIMIT 5",
    }
    for _name, _sql in _queries.items():
        _r = db.conn.execute(_sql).fetchdf()
        if not _r.empty:
            ok(f"{_name}: {len(_r)} 件")
        else:
            fail(f"{_name}: 0件")
            _all_ok = False

    # サンプル
    _sample = db.conn.execute(
        'SELECT "issue_key", "summary", "status" FROM issues_expanded LIMIT 3'
    ).fetchdf()
    if not _sample.empty:
        print(f"\n  サンプル:\n{_sample.to_string(index=False)}")

    db.conn.close()
    if use_test_db:
        os.remove(db_path)
        for _f in [db_path + ".wal", db_path.replace(".duckdb", "_state.json")]:
            if os.path.exists(_f):
                os.remove(_f)

    step("完了")
    if not _all_ok:
        print("  WARN: 一部のテストが失敗しています")
        sys.exit(1)
    print("  全テスト OK")


if __name__ == "__main__":
    main()
