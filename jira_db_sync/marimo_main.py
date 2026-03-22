import marimo

__generated_with = "0.21.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell
def _(mo):
    mo.md(r"""
    # Jira DB Sync

    Jira のデータを DuckDB に同期し、可視化するノートブックです。

    ## 環境変数の設定

    以下の環境変数を設定してください:

    以下の環境変数を `.env` ファイルまたはシェルで設定してください:

    - `JIRA_BASE_URL`: Jira のベース URL (例: `https://your-domain.atlassian.net`)
    - `JIRA_USERNAME`: Jira のユーザー名 (メールアドレス)
    - `JIRA_API_TOKEN`: Jira の API トークン
    - `JIRA_DB_PATH`: DuckDB ファイルの保存先 (デフォルト: `./data/jira.duckdb`)
    """)
    return


@app.cell
def _():
    import os
    import json
    import time
    from datetime import datetime, timezone
    from base64 import b64encode

    import requests
    import duckdb
    import pandas as pd
    from dotenv import load_dotenv

    # .env ファイルがあれば読み込む（既存の環境変数は上書きしない）
    load_dotenv(override=False)
    return b64encode, datetime, duckdb, json, os, pd, requests, time, timezone


@app.cell
def _(b64encode, mo, os):
    JIRA_BASE_URL = os.environ.get("JIRA_BASE_URL", "")
    JIRA_USERNAME = os.environ.get("JIRA_USERNAME", "")
    JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN", "")
    JIRA_DB_PATH = os.environ.get("JIRA_DB_PATH", "./data/jira.duckdb")
    JIRA_PROJECT = os.environ.get("JIRA_PROJECT", "")
    JIRA_AUTO_SYNC = os.environ.get("JIRA_AUTO_SYNC", "").lower() in ("1", "true", "yes", "full", "incremental")

    _missing = []
    if not JIRA_BASE_URL:
        _missing.append("JIRA_BASE_URL")
    if not JIRA_USERNAME:
        _missing.append("JIRA_USERNAME")
    if not JIRA_API_TOKEN:
        _missing.append("JIRA_API_TOKEN")

    if _missing:
        mo.stop(
            True,
            mo.md(
                f"**環境変数が未設定です:** {', '.join(_missing)}\n\n"
                "`.env` ファイルまたはシェルで設定してください。"
            ),
        )

    _credentials = f"{JIRA_USERNAME}:{JIRA_API_TOKEN}"
    AUTH_HEADER = f"Basic {b64encode(_credentials.encode()).decode()}"
    HEADERS = {
        "Authorization": AUTH_HEADER,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    _auto_mode = os.environ.get("JIRA_AUTO_SYNC", "").lower()
    _auto_label = ""
    if JIRA_AUTO_SYNC:
        _auto_label = f" | 自動同期: **{_auto_mode if _auto_mode in ('incremental',) else 'full'}**"
    if JIRA_PROJECT:
        _auto_label += f" | プロジェクト: **{JIRA_PROJECT}**"
    mo.md(f"Jira 接続先: **{JIRA_BASE_URL}** (ユーザー: {JIRA_USERNAME}){_auto_label}")
    return HEADERS, JIRA_AUTO_SYNC, JIRA_BASE_URL, JIRA_DB_PATH, JIRA_PROJECT


@app.cell
def _(HEADERS, JIRA_BASE_URL, requests, time):
    def jira_get(path: str, params: dict | None = None, max_retries: int = 3) -> dict:
        """Jira REST API v3 への GET リクエスト (リトライ付き)"""
        url = f"{JIRA_BASE_URL}/rest/api/3/{path}"
        for attempt in range(max_retries + 1):
            resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 2 ** (attempt + 1)))
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return {}

    def fetch_all_issues(
        jql: str,
        fields: str = "*navigable,created,updated",
        expand: str = "changelog",
        max_results: int = 100,
        on_progress=None,
    ) -> list[dict]:
        """search/jql エンドポイント + nextPageToken で全件再帰取得

        JIRA Cloud は expand=changelog を含めるとページサイズを小さく制限し、
        isLast=True を返す場合がある。そのため、まず changelog なしで issue key
        の全量を取得し、次に各バッチで changelog 付きで再取得する。
        """
        # Step 1: changelog なしで全 issue key を取得（高速・大量取得可能）
        all_keys = []
        page_token = None
        while True:
            params = {
                "jql": jql,
                "fields": "key",
                "maxResults": "1000",
            }
            if page_token:
                params["nextPageToken"] = page_token
            data = jira_get("search/jql", params=params)
            for _iss in data.get("issues", []):
                all_keys.append(_iss["key"])
            next_token = data.get("nextPageToken")
            is_last = data.get("isLast", True)
            if (is_last is True or is_last is None) and not next_token:
                break
            if not next_token:
                break
            page_token = next_token

        total = len(all_keys)

        if on_progress:
            on_progress(0, total)

        # Step 2: バッチごとに changelog 付きで取得
        all_issues = []
        batch_size = 50  # changelog 付きは 50 件ずつ
        for _i in range(0, total, batch_size):
            batch_keys = all_keys[_i : _i + batch_size]
            keys_jql = f"key in ({','.join(batch_keys)}) ORDER BY updated ASC"
            page_token = None
            while True:
                params = {
                    "jql": keys_jql,
                    "fields": fields,
                    "expand": expand,
                    "maxResults": str(batch_size),
                }
                if page_token:
                    params["nextPageToken"] = page_token
                data = jira_get("search/jql", params=params)
                issues = data.get("issues", [])
                all_issues.extend(issues)
                next_token = data.get("nextPageToken")
                is_last = data.get("isLast", True)
                if (is_last is True or is_last is None) and not next_token:
                    break
                if not next_token:
                    break
                page_token = next_token

            if on_progress:
                on_progress(len(all_issues), total)

        return all_issues

    print("API ヘルパー関数を定義しました")
    return fetch_all_issues, jira_get


@app.cell
def _(mo):
    mo.md("""
    ## 1. プロジェクト一覧
    """)
    return


@app.cell
def _(jira_get, mo, pd):
    _projects_raw = jira_get("project")
    projects_list = [
        {
            "id": p["id"],
            "key": p["key"],
            "name": p["name"],
            "description": p.get("description", ""),
            "style": p.get("style", ""),
            "raw_data": p,
        }
        for p in _projects_raw
    ]
    projects_df = pd.DataFrame(projects_list)
    mo.ui.table(projects_df[["id", "key", "name", "style"]])
    return projects_df, projects_list


@app.cell
def _(JIRA_PROJECT, mo, projects_df):
    # 環境変数 JIRA_PROJECT で初期値を指定可能
    _options = {row["key"]: row["key"] for _, row in projects_df.iterrows()}
    project_selector = mo.ui.dropdown(
        options=_options,
        value=JIRA_PROJECT if JIRA_PROJECT in _options else None,
        label="同期するプロジェクトを選択",
    )
    project_selector
    return (project_selector,)


@app.cell
def _(mo):
    mo.md("""
    ## 2. メタデータ取得
    """)
    return


@app.cell
def _(jira_get, mo, pd, project_selector, projects_df):
    mo.stop(not project_selector.value, mo.md("プロジェクトを選択してください"))

    selected_project_key = project_selector.value
    # プロジェクトの数値 ID を取得（API で必要）
    _proj_row = projects_df[projects_df["key"] == selected_project_key]
    selected_project_id = _proj_row["id"].iloc[0] if not _proj_row.empty else selected_project_key

    # ステータス取得
    _statuses_raw = jira_get(f"project/{selected_project_key}/statuses")
    statuses = []
    for _it in _statuses_raw:
        for _s in _it.get("statuses", []):
            statuses.append(
                {
                    "name": _s["name"],
                    "description": _s.get("description", ""),
                    "category": _s.get("statusCategory", {}).get("key", ""),
                }
            )
    # 重複除去
    _seen = set()
    statuses_unique = []
    for _s in statuses:
        if _s["name"] not in _seen:
            _seen.add(_s["name"])
            statuses_unique.append(_s)
    statuses_df = pd.DataFrame(statuses_unique)

    # 優先度取得
    _priorities_raw = jira_get("priority")
    priorities_df = pd.DataFrame(
        [{"name": p["name"], "description": p.get("description", "")} for p in _priorities_raw]
    )

    # 課題タイプ取得
    _types_raw = jira_get(f"issuetype/project?projectId={selected_project_id}")
    if isinstance(_types_raw, list):
        issue_types_df = pd.DataFrame(
            [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "subtask": t.get("subtask", False),
                }
                for t in _types_raw
            ]
        )
    else:
        issue_types_df = pd.DataFrame()

    # フィールド定義取得
    _fields_raw = jira_get("field")
    if isinstance(_fields_raw, list):
        fields_df = pd.DataFrame(
            [
                {
                    "id": _f.get("id", ""),
                    "key": _f.get("key", _f.get("id", "")),
                    "name": _f.get("name", ""),
                    "custom": _f.get("custom", False),
                    "searchable": _f.get("searchable", False),
                    "navigable": _f.get("navigable", False),
                    "orderable": _f.get("orderable", False),
                    "schema_type": (_f.get("schema") or {}).get("type"),
                    "schema_items": (_f.get("schema") or {}).get("items"),
                    "schema_system": (_f.get("schema") or {}).get("system"),
                    "schema_custom": (_f.get("schema") or {}).get("custom"),
                    "schema_custom_id": (_f.get("schema") or {}).get("customId"),
                }
                for _f in _fields_raw
            ]
        )
    else:
        fields_df = pd.DataFrame()

    mo.accordion(
        {
            f"ステータス ({len(statuses_df)})": mo.ui.table(statuses_df),
            f"優先度 ({len(priorities_df)})": mo.ui.table(priorities_df),
            f"課題タイプ ({len(issue_types_df)})": mo.ui.table(issue_types_df),
            f"フィールド ({len(fields_df)})": mo.ui.table(fields_df),
        }
    )
    return (
        fields_df,
        issue_types_df,
        priorities_df,
        selected_project_key,
        statuses_unique,
    )


@app.cell
def _(mo):
    mo.md("""
    ## 3. Issues 取得 (履歴付き)
    """)
    return


@app.cell
def _(JIRA_DB_PATH, json, mo, os, selected_project_key):
    # 前回同期情報を JSON ファイルで管理（DB 接続の競合を回避）
    _sync_state_path = os.path.join(
        os.path.dirname(JIRA_DB_PATH) or ".", "sync_state.json"
    )
    _state = {}
    if os.path.exists(_sync_state_path):
        try:
            with open(_sync_state_path) as _f:
                _state = json.load(_f)
        except Exception:
            pass

    _proj_state = _state.get(selected_project_key, {})
    _last_sync_info = _proj_state.get("last_sync") or None
    _checkpoint_info = _proj_state.get("checkpoint") or None

    _status_parts = []
    if _last_sync_info:
        _status_parts.append(
            f"前回同期: **{_last_sync_info['completed_at']}** "
            f"({_last_sync_info['sync_type']}, {_last_sync_info['items_synced']} 件)"
        )
    else:
        _status_parts.append("前回同期: なし")
    if _checkpoint_info:
        _status_parts.append(
            f"\n\n中断された同期あり: {_checkpoint_info['started_at']} "
            f"({_checkpoint_info['items_synced']} 件処理済み, "
            f"最終更新: {_checkpoint_info.get('checkpoint_updated_at', '不明')})"
        )
    last_sync_info = _last_sync_info
    checkpoint_info = _checkpoint_info
    sync_state_path = _sync_state_path
    mo.md("\n".join(_status_parts))
    return checkpoint_info, last_sync_info, sync_state_path


@app.cell
def _(JIRA_AUTO_SYNC, checkpoint_info, mo):
    full_sync_button = mo.ui.run_button(label="全件同期")
    incremental_sync_button = mo.ui.run_button(label="差分同期")
    _buttons = [full_sync_button, incremental_sync_button]
    if checkpoint_info:
        resume_sync_button = mo.ui.run_button(label="中断した同期を再開")
        _buttons.append(resume_sync_button)
    else:
        resume_sync_button = None

    if JIRA_AUTO_SYNC:
        mo.md("**自動同期モード**: 同期を自動実行します")
    else:
        mo.hstack(_buttons, gap=1)
    return full_sync_button, incremental_sync_button, resume_sync_button


@app.cell
def _(
    JIRA_AUTO_SYNC,
    checkpoint_info,
    datetime,
    fetch_all_issues,
    full_sync_button,
    incremental_sync_button,
    last_sync_info,
    mo,
    os,
    resume_sync_button,
    selected_project_key,
):
    # 自動同期モード判定
    _auto_mode = os.environ.get("JIRA_AUTO_SYNC", "").lower()
    _is_auto_incremental = _auto_mode == "incremental"

    # どのボタンが押されたか判定（自動同期の場合はボタン不要）
    _is_full = full_sync_button.value or (JIRA_AUTO_SYNC and not _is_auto_incremental)
    _is_incremental = incremental_sync_button.value or (JIRA_AUTO_SYNC and _is_auto_incremental)
    _is_resume = resume_sync_button.value if resume_sync_button else False

    mo.stop(
        not (_is_full or _is_incremental or _is_resume),
        mo.md("同期ボタンを押してください"),
    )

    # 同期モード決定
    if _is_resume and checkpoint_info:
        sync_mode = "resume"
        # チェックポイントの updated_at 以降を取得
        _after = checkpoint_info["checkpoint_updated_at"]
        _margin_minutes = 5
        _dt = datetime.fromisoformat(str(_after))
        _dt_with_margin = _dt - __import__("datetime").timedelta(minutes=_margin_minutes)
        _date_str = _dt_with_margin.strftime("%Y-%m-%d %H:%M")
        jql = (
            f"project = {selected_project_key} "
            f'AND updated >= "{_date_str}" '
            f"ORDER BY updated ASC, key ASC"
        )
    elif _is_incremental and last_sync_info and last_sync_info.get("completed_at"):
        sync_mode = "incremental"
        _margin_minutes = 5
        _dt = datetime.fromisoformat(str(last_sync_info["completed_at"]))
        _dt_with_margin = _dt - __import__("datetime").timedelta(minutes=_margin_minutes)
        _date_str = _dt_with_margin.strftime("%Y-%m-%d %H:%M")
        jql = (
            f"project = {selected_project_key} "
            f'AND updated >= "{_date_str}" '
            f"ORDER BY updated ASC, key ASC"
        )
    else:
        sync_mode = "full"
        jql = f"project = {selected_project_key} ORDER BY updated ASC, key ASC"

    mo.output.replace(mo.md(f"**{sync_mode}** 同期を開始... JQL: `{jql}`"))

    def _on_progress(fetched, total):
        mo.output.replace(
            mo.md(f"**{sync_mode}** 同期中... {fetched} / {total} 件")
        )

    raw_issues = fetch_all_issues(jql=jql, on_progress=_on_progress)
    mo.output.replace(
        mo.md(
            f"**{sync_mode}** 同期: **{len(raw_issues)} 件** の課題を取得しました"
        )
    )
    return raw_issues, sync_mode


@app.cell
def _(mo):
    mo.md("""
    ## 4. フィールド展開
    """)
    return


@app.cell
def _(json, mo, pd, raw_issues):
    def _extract_sprint(fields: dict) -> str | None:
        """Sprint フィールドの抽出"""
        for fid in ["sprint", "customfield_10020", "customfield_10104", "customfield_10000"]:
            val = fields.get(fid)
            if val is None:
                continue
            if isinstance(val, list):
                for sp in reversed(val):
                    if isinstance(sp, dict) and sp.get("name"):
                        state = sp.get("state", "")
                        if state in ("active", "closed", ""):
                            return sp["name"]
                for sp in val:
                    if isinstance(sp, dict) and sp.get("name"):
                        return sp["name"]
            elif isinstance(val, str) and "name=" in val:
                start = val.find("name=") + 5
                end = val.find(",", start)
                if end == -1:
                    end = val.find("]", start)
                if end != -1:
                    return val[start:end]
        return None

    def _safe_json(val) -> str | None:
        if val is None:
            return None
        return json.dumps(val, ensure_ascii=False)

    expanded_issues = []
    for _issue in raw_issues:
        _f = _issue.get("fields", {})
        expanded_issues.append(
            {
                "id": _issue["id"],
                "key": _issue["key"],
                "project_id": _f.get("project", {}).get("id", ""),
                "summary": _f.get("summary", ""),
                "description": _f.get("description"),
                "status": (_f.get("status") or {}).get("name"),
                "priority": (_f.get("priority") or {}).get("name"),
                "assignee": (_f.get("assignee") or {}).get("displayName"),
                "reporter": (_f.get("reporter") or {}).get("displayName"),
                "issue_type": (_f.get("issuetype") or {}).get("name"),
                "resolution": (_f.get("resolution") or {}).get("name"),
                "labels": _safe_json(_f.get("labels")),
                "components": _safe_json(
                    [c["name"] for c in (_f.get("components") or []) if "name" in c]
                ),
                "fix_versions": _safe_json(
                    [v["name"] for v in (_f.get("fixVersions") or []) if "name" in v]
                ),
                "sprint": _extract_sprint(_f),
                "parent_key": (_f.get("parent") or {}).get("key"),
                "due_date": _f.get("duedate"),
                "created_date": _f.get("created"),
                "updated_date": _f.get("updated"),
                "raw_data": json.dumps(_issue, ensure_ascii=False),
            }
        )

    issues_df = pd.DataFrame(expanded_issues)
    mo.md(f"展開済み: **{len(issues_df)}** 件, カラム数: {len(issues_df.columns)}")
    return (issues_df,)


@app.cell
def _(mo):
    mo.md("""
    ## 5. 履歴データ展開
    """)
    return


@app.cell
def _(pd, raw_issues):
    change_history_rows = []
    for _issue in raw_issues:
        _issue_id = _issue["id"]
        _issue_key = _issue["key"]
        _changelog = _issue.get("changelog", {})
        for _history in _changelog.get("histories", []):
            _history_id = _history.get("id", "")
            _author = _history.get("author", {})
            _changed_at = _history.get("created", "")
            for _item in _history.get("items", []):
                change_history_rows.append(
                    {
                        "issue_id": _issue_id,
                        "issue_key": _issue_key,
                        "history_id": _history_id,
                        "author_account_id": _author.get("accountId"),
                        "author_display_name": _author.get("displayName"),
                        "field": _item.get("field", ""),
                        "field_type": _item.get("fieldtype"),
                        "from_value": _item.get("from"),
                        "from_string": _item.get("fromString"),
                        "to_value": _item.get("to"),
                        "to_string": _item.get("toString"),
                        "changed_at": _changed_at,
                    }
                )

    change_history_df = pd.DataFrame(change_history_rows)
    print(f"履歴レコード: {len(change_history_df)} 件")
    change_history_df.head()
    return (change_history_df,)


@app.cell
def _(mo):
    mo.md("""
    ## 6. DuckDB への同期
    """)
    return


@app.cell
def _(JIRA_DB_PATH, duckdb, mo, os):
    """DB 接続とスキーマ初期化（1回だけ実行）"""
    os.makedirs(os.path.dirname(JIRA_DB_PATH) or ".", exist_ok=True)
    conn = duckdb.connect(JIRA_DB_PATH)

    _ddl = [
        """CREATE TABLE IF NOT EXISTS projects (
            id VARCHAR PRIMARY KEY, key VARCHAR NOT NULL, name VARCHAR NOT NULL,
            description TEXT, raw_data JSON,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS issues (
            id VARCHAR PRIMARY KEY, project_id VARCHAR NOT NULL,
            key VARCHAR NOT NULL, summary TEXT NOT NULL, description TEXT,
            status VARCHAR, priority VARCHAR, assignee VARCHAR, reporter VARCHAR,
            issue_type VARCHAR, resolution VARCHAR, labels JSON, components JSON,
            fix_versions JSON, sprint VARCHAR, parent_key VARCHAR,
            due_date VARCHAR, created_date VARCHAR, updated_date VARCHAR,
            raw_data JSON, synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS issue_change_history (
            issue_id VARCHAR NOT NULL, issue_key VARCHAR NOT NULL,
            history_id VARCHAR NOT NULL, author_account_id VARCHAR,
            author_display_name VARCHAR, field VARCHAR NOT NULL,
            field_type VARCHAR, from_value TEXT, from_string TEXT,
            to_value TEXT, to_string TEXT, changed_at VARCHAR NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS statuses (
            project_key VARCHAR NOT NULL, name VARCHAR NOT NULL,
            description VARCHAR, category VARCHAR,
            PRIMARY KEY (project_key, name)
        )""",
        """CREATE TABLE IF NOT EXISTS priorities (
            name VARCHAR PRIMARY KEY, description VARCHAR
        )""",
        """CREATE TABLE IF NOT EXISTS issue_types (
            name VARCHAR PRIMARY KEY, description VARCHAR,
            subtask BOOLEAN DEFAULT false
        )""",
        # issues_expanded はフィールド展開セルで動的に作成するためここでは定義しない
        """CREATE TABLE IF NOT EXISTS jira_fields (
            id VARCHAR PRIMARY KEY, key VARCHAR NOT NULL,
            name VARCHAR NOT NULL, custom BOOLEAN DEFAULT false,
            searchable BOOLEAN DEFAULT false, navigable BOOLEAN DEFAULT false,
            orderable BOOLEAN DEFAULT false, schema_type VARCHAR,
            schema_items VARCHAR, schema_system VARCHAR,
            schema_custom VARCHAR, schema_custom_id BIGINT,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS sync_history (
            id INTEGER PRIMARY KEY, project_key VARCHAR NOT NULL,
            sync_type VARCHAR NOT NULL, started_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ, status VARCHAR NOT NULL,
            items_synced INTEGER, checkpoint_updated_at TIMESTAMPTZ
        )""",
        "CREATE SEQUENCE IF NOT EXISTS sync_history_seq START 1",
        "CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(key)",
        "CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)",
        "CREATE INDEX IF NOT EXISTS idx_ch_issue_id ON issue_change_history(issue_id)",
        "CREATE INDEX IF NOT EXISTS idx_ch_field ON issue_change_history(field)",
    ]
    for _sql in _ddl:
        conn.execute(_sql)

    mo.md(f"DB 接続: `{JIRA_DB_PATH}`")
    return (conn,)


@app.cell
def _(
    JIRA_DB_PATH,
    change_history_df,
    conn,
    datetime,
    fields_df,
    issue_types_df,
    issues_df,
    json,
    mo,
    os,
    priorities_df,
    projects_list,
    selected_project_key,
    statuses_unique,
    sync_mode,
    sync_state_path,
    timezone,
):
    """データ同期の実行"""
    # -- チェックポイント: JSON ファイルに in_progress を記録
    _started_at = datetime.now(timezone.utc).isoformat()
    _checkpoint_state = [None]

    def _save_checkpoint(items_so_far, last_updated_at=None):
        _checkpoint_state[0] = last_updated_at
        _st = {}
        if os.path.exists(sync_state_path):
            try:
                with open(sync_state_path) as _ff:
                    _st = json.load(_ff)
            except Exception:
                pass
        _proj = _st.setdefault(selected_project_key, {})
        _proj["checkpoint"] = {
            "started_at": _started_at,
            "items_synced": items_so_far,
            "checkpoint_updated_at": str(last_updated_at) if last_updated_at else None,
        }
        with open(sync_state_path, "w") as _ff:
            json.dump(_st, _ff, ensure_ascii=False, indent=2)

    _save_checkpoint(0)

    # -- projects (UPSERT)
    for _p in projects_list:
        conn.execute(
            """INSERT INTO projects (id, key, name, description, raw_data)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                key = EXCLUDED.key, name = EXCLUDED.name,
                description = EXCLUDED.description, raw_data = EXCLUDED.raw_data""",
            [_p["id"], _p["key"], _p["name"], _p["description"],
             json.dumps(_p["raw_data"], ensure_ascii=False)],
        )

    # -- issues
    if not issues_df.empty:
        if sync_mode == "full":
            conn.execute(
                'DELETE FROM issues WHERE "key" LIKE ?',
                [f"{selected_project_key}-%"],
            )
        else:
            conn.execute("CREATE OR REPLACE TEMP TABLE tmp_del_ids AS SELECT id FROM issues_df")
            conn.execute("DELETE FROM issues WHERE id IN (SELECT id FROM tmp_del_ids)")
            conn.execute("DROP TABLE IF EXISTS tmp_del_ids")
        # DataFrame のカラム順とテーブルのカラム順を合わせて INSERT
        _tbl_col_order = [
            "id", "project_id", "key", "summary", "description",
            "status", "priority", "assignee", "reporter", "issue_type",
            "resolution", "labels", "components", "fix_versions", "sprint",
            "parent_key", "due_date", "created_date", "updated_date", "raw_data",
        ]
        conn.execute(
            "CREATE OR REPLACE TEMP TABLE tmp_reordered AS SELECT "
            + ", ".join(_tbl_col_order)
            + " FROM issues_df"
        )
        conn.execute(
            "INSERT INTO issues SELECT *, CURRENT_TIMESTAMP FROM tmp_reordered"
        )
        conn.execute("DROP TABLE IF EXISTS tmp_reordered")

        _last_updated = issues_df["updated_date"].max()
        _save_checkpoint(len(issues_df), _last_updated)

    # -- change history
    if not issues_df.empty:
        conn.execute(
            "DELETE FROM issue_change_history WHERE issue_key LIKE ?",
            [f"{selected_project_key}-%"],
        )
    if not change_history_df.empty:
        conn.execute("INSERT INTO issue_change_history SELECT * FROM change_history_df")

    # -- metadata
    conn.execute("DELETE FROM statuses WHERE project_key = ?", [selected_project_key])
    for _s in statuses_unique:
        conn.execute(
            "INSERT INTO statuses VALUES (?, ?, ?, ?)",
            [selected_project_key, _s["name"], _s["description"], _s["category"]],
        )
    if not priorities_df.empty:
        conn.execute("DELETE FROM priorities")
        conn.execute("INSERT INTO priorities SELECT name, description FROM priorities_df")
    if not issue_types_df.empty:
        conn.execute("DELETE FROM issue_types")
        conn.execute("INSERT INTO issue_types SELECT name, description, subtask FROM issue_types_df")
    if not fields_df.empty:
        conn.execute("DELETE FROM jira_fields")
        conn.execute(
            "INSERT INTO jira_fields SELECT *, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM fields_df"
        )

    # -- sync_history
    _completed_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO sync_history VALUES (
            nextval('sync_history_seq'), ?, ?, ?, ?, 'completed', ?, ?
        )""",
        [selected_project_key, sync_mode, _started_at, _completed_at,
         len(issues_df), str(_checkpoint_state[0]) if _checkpoint_state[0] else None],
    )

    # -- 同期完了: JSON 更新
    _st = {}
    if os.path.exists(sync_state_path):
        try:
            with open(sync_state_path) as _ff:
                _st = json.load(_ff)
        except Exception:
            pass
    _proj = _st.setdefault(selected_project_key, {})
    _proj.pop("checkpoint", None)
    _proj["last_sync"] = {
        "completed_at": _completed_at,
        "items_synced": len(issues_df),
        "sync_type": sync_mode,
    }
    with open(sync_state_path, "w") as _ff:
        json.dump(_st, _ff, ensure_ascii=False, indent=2)

    _summary = conn.execute(
        "SELECT COUNT(*) AS issues, (SELECT COUNT(*) FROM issue_change_history) AS history FROM issues"
    ).fetchdf()

    mo.md(
        f"**{sync_mode} 同期完了**\n\n"
        f"- 今回取得: **{len(issues_df)}** 件\n"
        f"- DB 内 Issues: **{_summary['issues'][0]}** 件\n"
        f"- 変更履歴: **{_summary['history'][0]}** 件\n"
        f"- DB: `{JIRA_DB_PATH}`"
    )
    sync_completed = True
    return (sync_completed,)


@app.cell
def _(mo):
    mo.md("""
    ## 7. フィールド展開 (issues_expanded)
    """)
    return


@app.cell
def _(conn, fields_df, mo, selected_project_key, sync_completed):
    """jira_fields 定義に基づいて issues.raw_data から全フィールドを動的に展開"""
    mo.stop(not sync_completed, mo.md("同期が完了していません"))
    mo.stop(fields_df.empty, mo.md("フィールド定義がありません"))

    # フィールドメタデータから展開不要なものを除外
    # navigable=True のフィールドのみ対象（API で取得可能なもの）
    _target_fields = fields_df[fields_df["navigable"] == True].to_dict("records")

    def _safe_str(val):
        """NaN/None を空文字に変換"""
        if val is None or (isinstance(val, float) and val != val):
            return ""
        return str(val).lower()

    # スキーマタイプから DuckDB カラム型を決定
    def _to_col_type(schema_type, schema_items):
        _st = _safe_str(schema_type)
        if _st in ("number", "numeric"):
            return "DOUBLE"
        elif _st == "datetime":
            return "TIMESTAMPTZ"
        elif _st == "date":
            return "DATE"
        elif _st == "array":
            return "JSON"
        elif _st == "any":
            return "JSON"
        else:
            return "VARCHAR"

    # フィールドから JSON 展開の SQL 式を生成
    def _to_select_expr(field_id, schema_type, schema_items, schema_system):
        _st = _safe_str(schema_type)
        _fid = field_id

        # オブジェクト型 (user, status, priority 等): name/displayName を抽出
        if _st == "user":
            return f"i.raw_data->'fields'->'{_fid}'->>'displayName'"
        elif _st in ("status", "priority", "resolution", "issuetype", "issuelink",
                      "securitylevel", "component", "version"):
            return f"i.raw_data->'fields'->'{_fid}'->>'name'"
        elif _st == "option":
            return (
                f"COALESCE("
                f"i.raw_data->'fields'->'{_fid}'->>'value', "
                f"i.raw_data->'fields'->'{_fid}'->>'name'"
                f")"
            )
        elif _st == "option-with-child":
            return (
                f"COALESCE("
                f"i.raw_data->'fields'->'{_fid}'->>'value', "
                f"i.raw_data->'fields'->'{_fid}'->>'name'"
                f")"
            )
        elif _st == "array":
            # 配列型: 要素の型に応じて展開
            _items = _safe_str(schema_items)
            if _items in ("user", "group"):
                # ユーザー/グループ配列 → displayName のリスト
                return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
            elif _items in ("component", "version", "issuelinks"):
                return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
            elif _items == "string":
                # ラベル等の文字列配列
                return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
            elif _items == "json":
                return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
            elif _items == "option":
                return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
            else:
                return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
        elif _st == "number":
            return f"TRY_CAST(i.raw_data->'fields'->>'{_fid}' AS DOUBLE)"
        elif _st == "datetime":
            return f"TRY_CAST(i.raw_data->'fields'->>'{_fid}' AS TIMESTAMP)"
        elif _st == "date":
            return f"TRY_CAST(i.raw_data->'fields'->>'{_fid}' AS TIMESTAMP)"
        elif _st == "progress":
            return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
        elif _st == "any":
            return f"TRY_CAST(i.raw_data->'fields'->'{_fid}' AS JSON)"
        elif _st == "string":
            return f"i.raw_data->'fields'->>'{_fid}'"
        else:
            # 不明な型: オブジェクトならname/value、それ以外は文字列
            return (
                f"COALESCE("
                f"i.raw_data->'fields'->'{_fid}'->>'name', "
                f"i.raw_data->'fields'->'{_fid}'->>'value', "
                f"i.raw_data->'fields'->'{_fid}'->>'displayName', "
                f"i.raw_data->'fields'->>'{_fid}'"
                f")"
            )

    # フィールドID → 安全なカラム名のマッピング
    # DuckDB の予約語や特殊文字を回避
    def _safe_col_name(field_id):
        return field_id.lower().replace("-", "_").replace(".", "_")

    # 固定カラム: id, project_id, issue_key は必ず含める
    _select_parts = [
        "i.id",
        "i.project_id",
        'COALESCE(i.raw_data->>\'key\', i."key") AS issue_key',
    ]
    _col_defs = [
        ("id", "VARCHAR PRIMARY KEY"),
        ("project_id", "VARCHAR NOT NULL"),
        ("issue_key", "VARCHAR NOT NULL"),
    ]
    _processed_cols = {"id", "project_id", "issue_key"}

    # メタデータから全フィールドの SELECT 式とカラム定義を生成
    for _f in _target_fields:
        _fid = _f["id"]
        _col = _safe_col_name(_fid)
        if _col in _processed_cols:
            continue
        _processed_cols.add(_col)

        _schema_type = _f.get("schema_type")
        _schema_items = _f.get("schema_items")
        _schema_system = _f.get("schema_system")
        _col_type = _to_col_type(_schema_type, _schema_items)
        _expr = _to_select_expr(_fid, _schema_type, _schema_items, _schema_system)

        _select_parts.append(f'{_expr} AS "{_col}"')
        _col_defs.append((_col, _col_type))

    # synced_at を最後に追加
    _select_parts.append("CURRENT_TIMESTAMP AS synced_at")
    _col_defs.append(("synced_at", "TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP"))

    # issues_expanded テーブルを DROP + CREATE で再作成（カラム構成が変わるため）
    conn.execute("DROP TABLE IF EXISTS issues_expanded")
    _create_cols = ", ".join(f'"{_c}" {_t}' for _c, _t in _col_defs)
    conn.execute(f"CREATE TABLE issues_expanded ({_create_cols})")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_expanded_project ON issues_expanded(project_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_expanded_key ON issues_expanded(issue_key)")

    # データ投入
    _select_sql = ",\n        ".join(_select_parts)
    _insert_sql = f"""
        INSERT INTO issues_expanded
        SELECT {_select_sql}
        FROM issues i
        WHERE i."key" LIKE '{selected_project_key}-%'
    """
    try:
        conn.execute(_insert_sql)
    except Exception as _e:
        print(f"[ERROR] INSERT INTO issues_expanded failed: {_e}")
        print(f"[DEBUG] SQL:\n{_insert_sql[:2000]}")
        raise

    # issues_readable ビュー (カラム名 → フィールド名)
    _field_name_map = dict(zip(fields_df["id"].str.lower(), fields_df["name"]))
    # 固定カラムの表示名
    _field_name_map.update({"id": "ID", "project_id": "Project ID", "issue_key": "Key", "synced_at": "同期日時"})
    _view_cols = []
    for _col, _ in _col_defs:
        _display = _field_name_map.get(_col, _col)
        _escaped = _display.replace('"', '""')
        _view_cols.append(f'"{_col}" AS "{_escaped}"')
    conn.execute(
        f"CREATE OR REPLACE VIEW issues_readable AS SELECT {', '.join(_view_cols)} FROM issues_expanded"
    )

    _expanded_count = conn.execute("SELECT COUNT(*) FROM issues_expanded").fetchone()[0]
    _issues_count = conn.execute("SELECT COUNT(*) FROM issues").fetchone()[0]
    _issues_with_raw = conn.execute(
        "SELECT COUNT(*) FROM issues WHERE raw_data IS NOT NULL"
    ).fetchone()[0]
    _matching_project = conn.execute(
        f"""SELECT COUNT(*) FROM issues WHERE "key" LIKE '{selected_project_key}-%'"""
    ).fetchone()[0]

    mo.md(
        f"**フィールド展開完了**\n\n"
        f"- issues テーブル: **{_issues_count}** 件 "
        f"(raw_data あり: {_issues_with_raw}, プロジェクト一致: {_matching_project})\n"
        f"- 展開済み: **{_expanded_count}** 件\n"
        f"- カラム数: **{len(_col_defs)}** (うちカスタムフィールド: "
        f"{sum(1 for _f in _target_fields if _f.get('custom'))})\n"
        f"- ビュー `issues_readable` を作成しました（フィールド名で参照可能）"
    )
    expand_completed = True
    return


@app.cell
def _(conn, expand_completed, mo):
    """issues_expanded のデータプレビュー"""
    mo.stop(not expand_completed, mo.md("フィールド展開が完了していません"))
    try:
        _cols = [_r[0] for _r in conn.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'issues_expanded' ORDER BY ordinal_position"
        ).fetchall()]
        # 最初の15カラムをプレビュー
        _preview_cols = ", ".join(f'"{_c}"' for _c in _cols[:15])
        _preview = conn.execute(f"SELECT {_preview_cols} FROM issues_expanded LIMIT 20").fetchdf()
        if not _preview.empty:
            mo.ui.table(_preview)
        else:
            mo.md("issues_expanded にデータがありません")
    except Exception as _e:
        mo.md(f"プレビュー取得エラー: {_e}")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 8. 可視化
    """)
    return


@app.cell
def _(conn, expand_completed, mo):
    mo.stop(not expand_completed, mo.md(""))
    import altair as alt

    # ステータス別課題数
    status_counts = conn.execute("""
        SELECT status, COUNT(*) as count
        FROM issues
        GROUP BY status
        ORDER BY count DESC
    """).fetchdf()

    _chart_status = (
        alt.Chart(status_counts)
        .mark_bar()
        .encode(
            x=alt.X("count:Q", title="件数"),
            y=alt.Y("status:N", title="ステータス", sort="-x"),
            color=alt.Color("status:N", legend=None),
        )
        .properties(title="ステータス別課題数", width=500, height=300)
    )

    # 優先度別課題数
    priority_counts = conn.execute("""
        SELECT priority, COUNT(*) as count
        FROM issues
        WHERE priority IS NOT NULL
        GROUP BY priority
        ORDER BY count DESC
    """).fetchdf()

    _chart_priority = (
        alt.Chart(priority_counts)
        .mark_bar()
        .encode(
            x=alt.X("count:Q", title="件数"),
            y=alt.Y("priority:N", title="優先度", sort="-x"),
            color=alt.Color("priority:N", legend=None),
        )
        .properties(title="優先度別課題数", width=500, height=200)
    )

    mo.vstack([mo.as_html(_chart_status), mo.as_html(_chart_priority)])
    return (alt,)


@app.cell
def _(alt, conn, mo):
    # 課題タイプ別
    type_counts = conn.execute("""
        SELECT issue_type, COUNT(*) as count
        FROM issues
        WHERE issue_type IS NOT NULL
        GROUP BY issue_type
        ORDER BY count DESC
    """).fetchdf()

    _chart_type = (
        alt.Chart(type_counts)
        .mark_arc(innerRadius=50)
        .encode(
            theta=alt.Theta("count:Q"),
            color=alt.Color("issue_type:N", title="課題タイプ"),
            tooltip=["issue_type:N", "count:Q"],
        )
        .properties(title="課題タイプ別割合", width=400, height=300)
    )

    # 担当者別課題数 (上位15)
    assignee_counts = conn.execute("""
        SELECT COALESCE(assignee, '未割当') as assignee, COUNT(*) as count
        FROM issues
        GROUP BY assignee
        ORDER BY count DESC
        LIMIT 15
    """).fetchdf()

    _chart_assignee = (
        alt.Chart(assignee_counts)
        .mark_bar()
        .encode(
            x=alt.X("count:Q", title="件数"),
            y=alt.Y("assignee:N", title="担当者", sort="-x"),
            color=alt.Color("assignee:N", legend=None),
        )
        .properties(title="担当者別課題数 (Top 15)", width=500, height=350)
    )

    mo.hstack([mo.as_html(_chart_type), mo.as_html(_chart_assignee)])
    return


@app.cell
def _(alt, conn, mo):
    # 月別作成数の推移
    monthly_created = conn.execute("""
        SELECT
            STRFTIME(CAST(created_date AS TIMESTAMP), '%Y-%m') as month,
            COUNT(*) as count
        FROM issues
        WHERE created_date IS NOT NULL
        GROUP BY month
        ORDER BY month
    """).fetchdf()

    _chart_trend = (
        alt.Chart(monthly_created)
        .mark_line(point=True)
        .encode(
            x=alt.X("month:T", title="月"),
            y=alt.Y("count:Q", title="作成数"),
            tooltip=["month:T", "count:Q"],
        )
        .properties(title="月別課題作成数の推移", width=700, height=300)
    )

    mo.as_html(_chart_trend)
    return


@app.cell
def _(alt, conn, mo):
    # 変更履歴: フィールド別変更回数 (上位10)
    field_changes = conn.execute("""
        SELECT field, COUNT(*) as count
        FROM issue_change_history
        GROUP BY field
        ORDER BY count DESC
        LIMIT 10
    """).fetchdf()

    _chart_changes = (
        alt.Chart(field_changes)
        .mark_bar()
        .encode(
            x=alt.X("count:Q", title="変更回数"),
            y=alt.Y("field:N", title="フィールド", sort="-x"),
            color=alt.Color("field:N", legend=None),
        )
        .properties(title="フィールド別変更回数 (Top 10)", width=500, height=300)
    )

    # ステータス遷移ヒートマップ
    status_transitions = conn.execute("""
        SELECT
            COALESCE(from_string, '(新規)') as from_status,
            to_string as to_status,
            COUNT(*) as count
        FROM issue_change_history
        WHERE field = 'status' AND to_string IS NOT NULL
        GROUP BY from_status, to_status
        ORDER BY count DESC
    """).fetchdf()

    _chart_transition = (
        alt.Chart(status_transitions)
        .mark_rect()
        .encode(
            x=alt.X("to_status:N", title="遷移先"),
            y=alt.Y("from_status:N", title="遷移元"),
            color=alt.Color("count:Q", title="回数", scale=alt.Scale(scheme="blues")),
            tooltip=["from_status:N", "to_status:N", "count:Q"],
        )
        .properties(title="ステータス遷移ヒートマップ", width=500, height=400)
    )

    mo.hstack([mo.as_html(_chart_changes), mo.as_html(_chart_transition)])
    return


@app.cell
def _(mo):
    mo.md("""
    ## 9. 履歴データ分析
    """)
    return


@app.cell
def _(conn, expand_completed, mo):
    mo.stop(not expand_completed, mo.md(""))
    # 変更履歴の日付範囲を取得
    _range = conn.execute("""
        SELECT
            MIN(CAST(changed_at AS DATE)) as min_date,
            MAX(CAST(changed_at AS DATE)) as max_date
        FROM issue_change_history
    """).fetchone()

    _min_date = str(_range[0]) if _range[0] else "2020-01-01"
    _max_date = str(_range[1]) if _range[1] else "2026-12-31"

    snapshot_date_picker = mo.ui.date(
        value=_max_date,
        label="時点を選択 (この日時点の状態を復元)",
    )
    snapshot_date_picker
    return (snapshot_date_picker,)


@app.cell
def _(conn, mo, snapshot_date_picker):
    _target_date = snapshot_date_picker.value

    # 指定日時点の各 issue の状態を復元する
    # 1. 指定日以前に作成された issue を対象
    # 2. 各フィールドの変更履歴を逆順に適用して、指定日時点の値を復元
    snapshot_df = conn.execute(
        """
        WITH target_issues AS (
            SELECT id, key, summary, status, priority, assignee, issue_type,
                   resolution, created_date, updated_date
            FROM issues
            WHERE CAST(created_date AS DATE) <= ?
        ),
        -- 指定日時点の status を復元
        status_at_date AS (
            SELECT
                h.issue_key,
                h.to_string as status_at_snapshot,
                ROW_NUMBER() OVER (
                    PARTITION BY h.issue_key
                    ORDER BY h.changed_at DESC
                ) as rn
            FROM issue_change_history h
            WHERE h.field = 'status'
              AND CAST(h.changed_at AS DATE) <= ?
        ),
        -- 指定日時点の assignee を復元
        assignee_at_date AS (
            SELECT
                h.issue_key,
                h.to_string as assignee_at_snapshot,
                ROW_NUMBER() OVER (
                    PARTITION BY h.issue_key
                    ORDER BY h.changed_at DESC
                ) as rn
            FROM issue_change_history h
            WHERE h.field = 'assignee'
              AND CAST(h.changed_at AS DATE) <= ?
        ),
        -- 指定日時点の priority を復元
        priority_at_date AS (
            SELECT
                h.issue_key,
                h.to_string as priority_at_snapshot,
                ROW_NUMBER() OVER (
                    PARTITION BY h.issue_key
                    ORDER BY h.changed_at DESC
                ) as rn
            FROM issue_change_history h
            WHERE h.field = 'priority'
              AND CAST(h.changed_at AS DATE) <= ?
        )
        SELECT
            t.key,
            t.summary,
            COALESCE(s.status_at_snapshot, t.status) as status,
            COALESCE(p.priority_at_snapshot, t.priority) as priority,
            COALESCE(a.assignee_at_snapshot, t.assignee) as assignee,
            t.issue_type,
            COALESCE(
                CASE WHEN s.status_at_snapshot IN ('Done', '完了', 'Closed', 'Resolved')
                     THEN s.status_at_snapshot END,
                CASE WHEN t.resolution IS NOT NULL
                     AND CAST(t.updated_date AS DATE) <= ?
                     THEN t.resolution END
            ) as resolution,
            t.created_date
        FROM target_issues t
        LEFT JOIN status_at_date s ON t.key = s.issue_key AND s.rn = 1
        LEFT JOIN assignee_at_date a ON t.key = a.issue_key AND a.rn = 1
        LEFT JOIN priority_at_date p ON t.key = p.issue_key AND p.rn = 1
        ORDER BY t.key
        """,
        [str(_target_date)] * 5,
    ).fetchdf()

    mo.md(f"### {_target_date} 時点の課題一覧 ({len(snapshot_df)} 件)")
    return (snapshot_df,)


@app.cell
def _(mo, snapshot_df):
    mo.ui.table(snapshot_df)
    return


@app.cell
def _(alt, mo, snapshot_df):
    # 指定日時点のステータス別集計
    if not snapshot_df.empty:
        _status_snap = snapshot_df.groupby("status").size().reset_index(name="count")
        _chart_snap = (
            alt.Chart(_status_snap)
            .mark_bar()
            .encode(
                x=alt.X("count:Q", title="件数"),
                y=alt.Y("status:N", title="ステータス", sort="-x"),
                color=alt.Color("status:N", legend=None),
            )
            .properties(title="指定日時点のステータス別課題数", width=500, height=250)
        )
        mo.as_html(_chart_snap)
    else:
        mo.md("データがありません")
    return


@app.cell
def _(mo):
    mo.md("""
    ### 日別ステータス推移
    """)
    return


@app.cell
def _(alt, conn, mo, pd):
    # 日別のステータス別件数推移を計算
    # 方針: 各 issue のステータス変更イベントを時系列で追い、
    #        各日の各ステータスの累積件数を計算する

    # 1. 各 issue の初期ステータスと作成日を取得
    # 2. ステータス変更イベント(from→to)を日単位で集約
    # 3. 日ごとにステータス別の増減を計算し累積する
    _events_df = conn.execute("""
        WITH
        -- 各 issue の初期ステータス: 最初の status 変更の from_string、なければ現在の status
        initial_status AS (
            SELECT
                i."key" as issue_key,
                CAST(i.created_date AS DATE) as dt,
                COALESCE(
                    (SELECT h.from_string
                     FROM issue_change_history h
                     WHERE h.issue_key = i."key" AND h.field = 'status'
                     ORDER BY h.changed_at ASC LIMIT 1),
                    i.status
                ) as status
            FROM issues i
            WHERE i.created_date IS NOT NULL
        ),
        -- 作成イベント: +1
        created_events AS (
            SELECT dt, status, COUNT(*) as delta
            FROM initial_status
            GROUP BY dt, status
        ),
        -- ステータス変更イベント: from に -1、to に +1
        change_out AS (
            SELECT CAST(changed_at AS DATE) as dt, from_string as status, -COUNT(*) as delta
            FROM issue_change_history
            WHERE field = 'status' AND from_string IS NOT NULL
            GROUP BY dt, status
        ),
        change_in AS (
            SELECT CAST(changed_at AS DATE) as dt, to_string as status, COUNT(*) as delta
            FROM issue_change_history
            WHERE field = 'status' AND to_string IS NOT NULL
            GROUP BY dt, status
        ),
        -- 全イベントを結合
        all_events AS (
            SELECT * FROM created_events
            UNION ALL SELECT * FROM change_out
            UNION ALL SELECT * FROM change_in
        ),
        -- 日 × ステータス 別に delta を合算
        daily_delta AS (
            SELECT dt, status, SUM(delta) as delta
            FROM all_events
            WHERE status IS NOT NULL
            GROUP BY dt, status
        )
        SELECT dt as date, status, delta
        FROM daily_delta
        ORDER BY dt, status
    """).fetchdf()

    if not _events_df.empty:
        # 累積合計を計算して日別ステータス件数にする
        _all_statuses = _events_df["status"].unique()
        _all_dates = pd.date_range(
            _events_df["date"].min(), _events_df["date"].max(), freq="D"
        )

        # pivot して日 × ステータスの delta テーブルを作成、欠損は0
        _pivot = _events_df.pivot_table(
            index="date", columns="status", values="delta", aggfunc="sum", fill_value=0
        )
        _pivot = _pivot.reindex(_all_dates, fill_value=0)
        _pivot.index.name = "date"

        # 累積合計
        _cumsum = _pivot.cumsum()

        # long form に変換
        _daily_status = _cumsum.reset_index().melt(
            id_vars="date", var_name="status", value_name="count"
        )
        # 0以下は除外（ステータスが存在しない期間）
        _daily_status = _daily_status[_daily_status["count"] > 0]

        _chart_daily = (
            alt.Chart(_daily_status)
            .mark_area()
            .encode(
                x=alt.X("date:T", title="日付"),
                y=alt.Y("count:Q", title="件数", stack=True),
                color=alt.Color("status:N", title="ステータス"),
                tooltip=["date:T", "status:N", "count:Q"],
            )
            .properties(title="日別ステータス別件数推移", width=800, height=400)
        )
        mo.as_html(_chart_daily)
    else:
        mo.md("データがありません")
    return


@app.cell
def _(alt, conn, mo):
    # 日別の作成・完了件数推移
    daily_created_resolved = conn.execute("""
        WITH created AS (
            SELECT CAST(created_date AS DATE) as dt, COUNT(*) as created_count
            FROM issues
            WHERE created_date IS NOT NULL
            GROUP BY dt
        ),
        resolved AS (
            SELECT CAST(changed_at AS DATE) as dt, COUNT(*) as resolved_count
            FROM issue_change_history
            WHERE field = 'status'
              AND to_string IN ('Done', '完了', 'Closed', 'Resolved')
            GROUP BY dt
        )
        SELECT
            COALESCE(c.dt, r.dt) as date,
            COALESCE(c.created_count, 0) as created,
            COALESCE(r.resolved_count, 0) as resolved
        FROM created c
        FULL OUTER JOIN resolved r ON c.dt = r.dt
        ORDER BY date
    """).fetchdf()

    if not daily_created_resolved.empty:
        # 累積件数を計算
        daily_created_resolved["cumulative_created"] = daily_created_resolved["created"].cumsum()
        daily_created_resolved["cumulative_resolved"] = daily_created_resolved["resolved"].cumsum()
        daily_created_resolved["open_count"] = (
            daily_created_resolved["cumulative_created"]
            - daily_created_resolved["cumulative_resolved"]
        )

        # 日別の作成・完了件数
        _melted = daily_created_resolved.melt(
            id_vars=["date"],
            value_vars=["created", "resolved"],
            var_name="type",
            value_name="count",
        )
        _chart_cr = (
            alt.Chart(_melted)
            .mark_bar(opacity=0.7)
            .encode(
                x=alt.X("date:T", title="日付"),
                y=alt.Y("count:Q", title="件数"),
                color=alt.Color(
                    "type:N",
                    title="種別",
                    scale=alt.Scale(
                        domain=["created", "resolved"],
                        range=["#4c78a8", "#72b7b2"],
                    ),
                ),
                tooltip=["date:T", "type:N", "count:Q"],
            )
            .properties(title="日別 作成・完了件数", width=800, height=300)
        )

        # 未完了（オープン）件数の推移
        _chart_open = (
            alt.Chart(daily_created_resolved)
            .mark_line(color="#e45756", strokeWidth=2)
            .encode(
                x=alt.X("date:T", title="日付"),
                y=alt.Y("open_count:Q", title="未完了件数"),
                tooltip=["date:T", "open_count:Q"],
            )
            .properties(title="未完了（オープン）件数の推移", width=800, height=250)
        )

        mo.vstack([mo.as_html(_chart_cr), mo.as_html(_chart_open)])
    else:
        mo.md("データがありません")
    return


@app.cell
def _(conn, expand_completed, mo):
    mo.stop(not expand_completed, mo.md(""))
    # DB テーブル一覧と件数
    _tables = conn.execute("""
        SELECT table_name, estimated_size
        FROM duckdb_tables()
        ORDER BY table_name
    """).fetchdf()

    mo.md("### DB テーブル一覧")
    return


@app.cell
def _(conn, expand_completed, mo):
    mo.stop(not expand_completed, mo.md(""))
    _tables_info = conn.execute("""
        SELECT table_name, estimated_size
        FROM duckdb_tables()
        ORDER BY table_name
    """).fetchdf()
    mo.ui.table(_tables_info)
    return


@app.cell
def _(mo):
    sql_input = mo.ui.text_area(
        label="SQL クエリ (読み取り専用)",
        value="SELECT key, summary, status, priority, assignee FROM issues LIMIT 20",
        full_width=True,
    )
    sql_input
    return (sql_input,)


@app.cell
def _(conn, expand_completed, mo, sql_input):
    mo.stop(not expand_completed, mo.md(""))
    _query = sql_input.value.strip()
    if _query:
        try:
            _result = conn.execute(_query).fetchdf()
            mo.ui.table(_result)
        except Exception as e:
            mo.md(f"**エラー:** {e}")
    return



if __name__ == "__main__":
    app.run()
