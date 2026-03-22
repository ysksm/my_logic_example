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

    ## 環境変数

    `.env` ファイルまたはシェルで設定:

    | 変数 | 必須 | 説明 |
    |------|------|------|
    | `JIRA_BASE_URL` | Yes | Jira ベース URL |
    | `JIRA_USERNAME` | Yes | ユーザー名 (メール) |
    | `JIRA_API_TOKEN` | Yes | API トークン |
    | `JIRA_DB_PATH` | No | DB パス (default: `./data/jira.duckdb`) |
    | `JIRA_PROJECT` | No | プロジェクトキー (ドロップダウン初期値) |
    | `JIRA_AUTO_SYNC` | No | `full` / `incremental` で自動同期 |
    """)
    return


@app.cell
def _():
    import os

    import pandas as pd
    from dotenv import load_dotenv

    from jira_sync import JiraClient, Database, SyncService, FieldExpander
    from jira_sync.sync import SyncState

    load_dotenv(override=False)

    JIRA_BASE_URL = os.environ.get("JIRA_BASE_URL", "")
    JIRA_USERNAME = os.environ.get("JIRA_USERNAME", "")
    JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN", "")
    JIRA_DB_PATH = os.environ.get("JIRA_DB_PATH", "./data/jira.duckdb")
    JIRA_PROJECT = os.environ.get("JIRA_PROJECT", "")
    JIRA_AUTO_SYNC = os.environ.get("JIRA_AUTO_SYNC", "").lower() in (
        "1", "true", "yes", "full", "incremental",
    )
    return (
        Database,
        JIRA_API_TOKEN,
        JIRA_AUTO_SYNC,
        JIRA_BASE_URL,
        JIRA_DB_PATH,
        JIRA_PROJECT,
        JIRA_USERNAME,
        JiraClient,
        SyncService,
        SyncState,
        os,
        pd,
    )


@app.cell
def _(
    Database,
    JIRA_API_TOKEN,
    JIRA_AUTO_SYNC,
    JIRA_BASE_URL,
    JIRA_DB_PATH,
    JIRA_PROJECT,
    JIRA_USERNAME,
    JiraClient,
    SyncState,
    mo,
    os,
):
    _missing = [v for v in ["JIRA_BASE_URL", "JIRA_USERNAME", "JIRA_API_TOKEN"]
                if not os.environ.get(v)]
    mo.stop(bool(_missing), mo.md(
        f"**環境変数が未設定です:** {', '.join(_missing)}"
    ))

    client = JiraClient(JIRA_BASE_URL, JIRA_USERNAME, JIRA_API_TOKEN)
    db = Database(JIRA_DB_PATH)
    sync_state = SyncState(
        os.path.join(os.path.dirname(JIRA_DB_PATH) or ".", "sync_state.json")
    )

    _info = f"Jira: **{JIRA_BASE_URL}** | DB: `{JIRA_DB_PATH}`"
    if JIRA_PROJECT:
        _info += f" | Project: **{JIRA_PROJECT}**"
    if JIRA_AUTO_SYNC:
        _info += f" | Auto: **{os.environ.get('JIRA_AUTO_SYNC', '')}**"
    mo.md(_info)
    return client, db, sync_state


@app.cell
def _(mo):
    mo.md("""
    ## 1. プロジェクト選択
    """)
    return


@app.cell
def _(client, mo, pd):
    _raw = client.fetch_projects()
    projects = [{"id": p["id"], "key": p["key"], "name": p["name"],
                 "description": p.get("description", ""), "raw_data": p}
                for p in _raw]
    projects_df = pd.DataFrame(projects)
    mo.ui.table(projects_df[["id", "key", "name"]])
    return projects, projects_df


@app.cell
def _(JIRA_PROJECT, mo, projects_df):
    _options = {r["key"]: r["key"] for _, r in projects_df.iterrows()}
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
def _(client, mo, pd, project_selector, projects_df):
    mo.stop(not project_selector.value, mo.md("プロジェクトを選択してください"))
    selected_project = project_selector.value
    _proj_row = projects_df[projects_df["key"] == selected_project]
    _project_id = _proj_row["id"].iloc[0] if not _proj_row.empty else selected_project

    statuses = client.fetch_project_statuses(selected_project)
    statuses_df = pd.DataFrame(statuses)
    priorities_df = pd.DataFrame(client.fetch_priorities())
    issue_types_raw = client.fetch_issue_types(_project_id)
    issue_types_df = pd.DataFrame(issue_types_raw) if issue_types_raw else pd.DataFrame()
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

    mo.accordion({
        f"ステータス ({len(statuses_df)})": mo.ui.table(statuses_df),
        f"優先度 ({len(priorities_df)})": mo.ui.table(priorities_df),
        f"課題タイプ ({len(issue_types_df)})": mo.ui.table(issue_types_df),
        f"フィールド ({len(fields_df)})": mo.ui.table(fields_df),
    })
    return fields_df, issue_types_df, priorities_df, selected_project, statuses


@app.cell
def _(mo):
    mo.md("""
    ## 3. 同期実行
    """)
    return


@app.cell
def _(mo, selected_project, sync_state):
    _last = sync_state.get_last_sync(selected_project)
    _cp = sync_state.get_checkpoint(selected_project)
    _parts = []
    if _last:
        _parts.append(f"前回: **{_last['completed_at']}** ({_last['sync_type']}, {_last['items_synced']}件)")
    else:
        _parts.append("前回同期: なし")
    if _cp:
        _parts.append(f"中断あり: {_cp['started_at']} ({_cp['items_synced']}件処理済み)")
    last_sync_info = _last
    checkpoint_info = _cp
    mo.md(" | ".join(_parts))
    return (checkpoint_info,)


@app.cell
def _(JIRA_AUTO_SYNC, checkpoint_info, mo):
    full_btn = mo.ui.run_button(label="全件同期")
    incr_btn = mo.ui.run_button(label="差分同期")
    _btns = [full_btn, incr_btn]
    if checkpoint_info:
        resume_btn = mo.ui.run_button(label="中断再開")
        _btns.append(resume_btn)
    else:
        resume_btn = None
    if JIRA_AUTO_SYNC:
        mo.md("**自動同期モード**")
    else:
        mo.hstack(_btns, gap=1)
    return full_btn, incr_btn, resume_btn


@app.cell
def _(
    JIRA_AUTO_SYNC,
    SyncService,
    client,
    db,
    fields_df,
    full_btn,
    incr_btn,
    issue_types_df,
    mo,
    os,
    priorities_df,
    projects,
    resume_btn,
    selected_project,
    statuses,
    sync_state,
):
    # 同期モード判定
    _auto_mode = os.environ.get("JIRA_AUTO_SYNC", "").lower()
    _is_full = full_btn.value or (JIRA_AUTO_SYNC and _auto_mode != "incremental")
    _is_incr = incr_btn.value or (JIRA_AUTO_SYNC and _auto_mode == "incremental")
    _is_resume = resume_btn.value if resume_btn else False

    mo.stop(not (_is_full or _is_incr or _is_resume), mo.md("同期ボタンを押してください"))

    _mode = "resume" if _is_resume else ("incremental" if _is_incr else "full")

    def _on_progress(_fetched, _total):
        mo.output.replace(mo.md(f"**{_mode}** 同期中... {_fetched} / {_total} 件"))

    mo.output.replace(mo.md(f"**{_mode}** 同期を開始..."))

    _svc = SyncService(client, db, sync_state)
    sync_result = _svc.execute(
        project_key=selected_project,
        mode=_mode,
        projects=projects,
        statuses=statuses,
        priorities_df=priorities_df,
        issue_types_df=issue_types_df,
        fields_df=fields_df,
        on_progress=_on_progress,
    )

    _s = sync_result["summary"]
    _e = sync_result.get("expanded", {})
    mo.md(
        f"**{_mode} 同期完了**\n\n"
        f"- 取得: **{sync_result['fetched']}** 件\n"
        f"- DB Issues: **{_s['issues']}** 件 | 変更履歴: **{_s['history']}** 件\n"
        f"- 展開: **{_e.get('expanded', 0)}** 件 ({_e.get('columns', 0)} カラム)"
    )
    return (sync_result,)


@app.cell
def _(mo):
    mo.md("""
    ## 4. 可視化
    """)
    return


@app.cell
def _(db, mo, sync_result):
    mo.stop(not sync_result, mo.md(""))
    import altair as alt

    _conn = db.conn
    _status = _conn.execute(
        "SELECT status, COUNT(*) as count FROM issues GROUP BY status ORDER BY count DESC"
    ).fetchdf()
    _priority = _conn.execute(
        "SELECT priority, COUNT(*) as count FROM issues WHERE priority IS NOT NULL GROUP BY priority ORDER BY count DESC"
    ).fetchdf()

    _c1 = alt.Chart(_status).mark_bar().encode(
        x=alt.X("count:Q", title="件数"), y=alt.Y("status:N", sort="-x"),
        color=alt.Color("status:N", legend=None),
    ).properties(title="ステータス別", width=500, height=300)

    _c2 = alt.Chart(_priority).mark_bar().encode(
        x=alt.X("count:Q", title="件数"), y=alt.Y("priority:N", sort="-x"),
        color=alt.Color("priority:N", legend=None),
    ).properties(title="優先度別", width=500, height=200)

    mo.vstack([mo.as_html(_c1), mo.as_html(_c2)])
    return (alt,)


@app.cell
def _(alt, db, mo):
    _conn = db.conn
    _types = _conn.execute(
        "SELECT issue_type, COUNT(*) as count FROM issues WHERE issue_type IS NOT NULL GROUP BY issue_type ORDER BY count DESC"
    ).fetchdf()
    _assignees = _conn.execute(
        "SELECT COALESCE(assignee, '未割当') as assignee, COUNT(*) as count FROM issues GROUP BY assignee ORDER BY count DESC LIMIT 15"
    ).fetchdf()

    _c1 = alt.Chart(_types).mark_arc(innerRadius=50).encode(
        theta="count:Q", color=alt.Color("issue_type:N", title="課題タイプ"),
        tooltip=["issue_type:N", "count:Q"],
    ).properties(title="課題タイプ別", width=400, height=300)

    _c2 = alt.Chart(_assignees).mark_bar().encode(
        x="count:Q", y=alt.Y("assignee:N", sort="-x"),
        color=alt.Color("assignee:N", legend=None),
    ).properties(title="担当者別 (Top 15)", width=500, height=350)

    mo.hstack([mo.as_html(_c1), mo.as_html(_c2)])
    return


@app.cell
def _(alt, db, mo):
    _monthly = db.conn.execute("""
        SELECT STRFTIME(CAST(created_date AS TIMESTAMP), '%Y-%m') as month, COUNT(*) as count
        FROM issues WHERE created_date IS NOT NULL GROUP BY month ORDER BY month
    """).fetchdf()
    _c = alt.Chart(_monthly).mark_line(point=True).encode(
        x=alt.X("month:T", title="月"), y=alt.Y("count:Q", title="作成数"),
        tooltip=["month:T", "count:Q"],
    ).properties(title="月別課題作成数", width=700, height=300)
    mo.as_html(_c)
    return


@app.cell
def _(alt, db, mo):
    _conn = db.conn
    _fields = _conn.execute(
        "SELECT field, COUNT(*) as count FROM issue_change_history GROUP BY field ORDER BY count DESC LIMIT 10"
    ).fetchdf()
    _transitions = _conn.execute("""
        SELECT COALESCE(from_string, '(新規)') as from_status, to_string as to_status, COUNT(*) as count
        FROM issue_change_history WHERE field = 'status' AND to_string IS NOT NULL
        GROUP BY from_status, to_status ORDER BY count DESC
    """).fetchdf()

    _c1 = alt.Chart(_fields).mark_bar().encode(
        x="count:Q", y=alt.Y("field:N", sort="-x"), color=alt.Color("field:N", legend=None),
    ).properties(title="フィールド別変更回数 (Top 10)", width=500, height=300)

    _c2 = alt.Chart(_transitions).mark_rect().encode(
        x=alt.X("to_status:N", title="遷移先"), y=alt.Y("from_status:N", title="遷移元"),
        color=alt.Color("count:Q", scale=alt.Scale(scheme="blues")),
        tooltip=["from_status:N", "to_status:N", "count:Q"],
    ).properties(title="ステータス遷移", width=500, height=400)

    mo.hstack([mo.as_html(_c1), mo.as_html(_c2)])
    return


@app.cell
def _(mo):
    mo.md("""
    ## 5. 履歴データ分析
    """)
    return


@app.cell
def _(db, mo, sync_result):
    """日別ステータス件数データを計算"""
    mo.stop(not sync_result, mo.md(""))
    from jira_sync.history import compute_daily_status_counts
    daily_status = compute_daily_status_counts(db.conn)
    mo.md(f"日別ステータスデータ: **{len(daily_status)}** 行")
    return (daily_status,)


@app.cell
def _(daily_status, mo):
    """日別ステータス件数のピボットテーブル"""
    mo.stop(daily_status is None or len(daily_status) == 0, mo.md(""))
    _pivot = daily_status.pivot_table(
        index="date", columns="status", values="count", fill_value=0,
    ).reset_index()
    _pivot["date"] = _pivot["date"].dt.strftime("%Y-%m-%d")
    _pivot["合計"] = _pivot.select_dtypes(include="number").sum(axis=1).astype(int)
    # float → int
    for _col in _pivot.columns:
        if _pivot[_col].dtype == "float64":
            _pivot[_col] = _pivot[_col].astype(int)
    mo.ui.table(_pivot, label="日別ステータス件数")
    return


@app.cell
def _(alt, daily_status, mo):
    """日別ステータス件数のエリアチャート（積み上げ）"""
    mo.stop(daily_status is None or len(daily_status) == 0, mo.md("日別データなし"))
    daily_status_chart = (
        alt.Chart(daily_status)
        .mark_area()
        .encode(
            x=alt.X("date:T", title="日付"),
            y=alt.Y("count:Q", title="件数", stack=True),
            color=alt.Color("status:N", title="ステータス"),
            tooltip=["date:T", "status:N", "count:Q"],
        )
        .properties(title="日別ステータス別件数推移（積み上げ）", width=800, height=400)
    )
    daily_status_chart
    return (daily_status_chart,)


@app.cell
def _(daily_status, mo):
    """スライダーで日付を選択"""
    if not daily_status.empty:
        _dates = sorted(daily_status["date"].unique())
        snapshot_slider = mo.ui.slider(
            start=0, stop=len(_dates) - 1, value=len(_dates) - 1,
            label="日付を選択",
            show_value=True,
        )
        available_dates = _dates
        snapshot_slider
    else:
        snapshot_slider = None
        available_dates = []
        mo.md("データなし")
    return available_dates, snapshot_slider


@app.cell
def _(alt, available_dates, daily_status, mo, snapshot_slider):
    """選択日のステータス別件数バーチャート"""
    if snapshot_slider is not None and available_dates:
        _idx = snapshot_slider.value
        _selected_date = available_dates[_idx]
        _day_data = daily_status[daily_status["date"] == _selected_date]
        _total = int(_day_data["count"].sum())
        _date_str = _selected_date.strftime('%Y-%m-%d')

        if not _day_data.empty:
            _c = alt.Chart(_day_data).mark_bar().encode(
                x=alt.X("count:Q", title="件数"),
                y=alt.Y("status:N", title="ステータス", sort="-x"),
                color=alt.Color("status:N", legend=None),
                tooltip=["status:N", "count:Q"],
            ).properties(
                title=f"{_date_str} 時点のステータス別件数（合計: {_total}件）",
                width=500, height=250,
            )
            mo.vstack([mo.md(f"**{_date_str}**"), mo.as_html(_c)])
        else:
            mo.md(f"{_date_str}: データなし")
    else:
        mo.md("")
    return


@app.cell
def _(mo):
    mo.md("""
    ### 任意日時点の課題一覧
    """)
    return


@app.cell
def _(db, mo, sync_result):
    """日付ピッカー"""
    mo.stop(not sync_result, mo.md(""))
    _range = db.conn.execute("""
        SELECT MIN(CAST(changed_at AS DATE)), MAX(CAST(changed_at AS DATE))
        FROM issue_change_history
    """).fetchone()
    _max = str(_range[1]) if _range[1] else "2026-12-31"
    snapshot_date = mo.ui.date(value=_max, label="時点を選択")
    snapshot_date
    return (snapshot_date,)


@app.cell
def _(db, mo, snapshot_date):
    """指定日時点の課題一覧を復元"""
    from jira_sync.history import get_snapshot_at_date
    _d = str(snapshot_date.value)
    snapshot_df = get_snapshot_at_date(db.conn, _d)
    mo.md(f"### {_d} 時点の課題一覧 ({len(snapshot_df)} 件)")
    return (snapshot_df,)


@app.cell
def _(mo, snapshot_df):
    mo.ui.table(snapshot_df)
    return


@app.cell
def _(alt, mo, snapshot_df):
    """指定日時点のステータス別チャート"""
    if not snapshot_df.empty:
        _s = snapshot_df.groupby("status").size().reset_index(name="count")
        _c = alt.Chart(_s).mark_bar().encode(
            x="count:Q", y=alt.Y("status:N", sort="-x"),
            color=alt.Color("status:N", legend=None),
        ).properties(title="指定日時点のステータス別", width=500, height=250)
        mo.as_html(_c)
    else:
        mo.md("データなし")
    return


@app.cell
def _(alt, db, mo, sync_result):
    """日別 作成・完了件数 + 未完了推移"""
    mo.stop(not sync_result, mo.md(""))
    _cr = db.conn.execute("""
        WITH cr AS (SELECT CAST(created_date AS DATE) as dt, COUNT(*) as c FROM issues WHERE created_date IS NOT NULL GROUP BY dt),
        rv AS (SELECT CAST(changed_at AS DATE) as dt, COUNT(*) as c FROM issue_change_history
               WHERE field='status' AND to_string IN ('Done','完了','Closed','Resolved') GROUP BY dt)
        SELECT COALESCE(c.dt,r.dt) as date, COALESCE(c.c,0) as created, COALESCE(r.c,0) as resolved
        FROM cr c FULL OUTER JOIN rv r ON c.dt=r.dt ORDER BY date
    """).fetchdf()

    if not _cr.empty:
        _cr["open"] = _cr["created"].cumsum() - _cr["resolved"].cumsum()
        _m = _cr.melt(id_vars=["date"], value_vars=["created","resolved"], var_name="type", value_name="count")
        _c1 = alt.Chart(_m).mark_bar(opacity=0.7).encode(
            x="date:T", y="count:Q",
            color=alt.Color("type:N", scale=alt.Scale(domain=["created","resolved"], range=["#4c78a8","#72b7b2"])),
        ).properties(title="日別 作成・完了件数", width=800, height=300)
        _c2 = alt.Chart(_cr).mark_line(color="#e45756", strokeWidth=2).encode(
            x="date:T", y=alt.Y("open:Q", title="未完了"),
        ).properties(title="未完了件数の推移", width=800, height=250)
        mo.vstack([mo.as_html(_c1), mo.as_html(_c2)])
    else:
        mo.md("データなし")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 6. SQL クエリ
    """)
    return


@app.cell
def _(db, mo, sync_result):
    mo.stop(not sync_result, mo.md(""))
    _t = db.conn.execute("SELECT table_name, estimated_size FROM duckdb_tables() ORDER BY table_name").fetchdf()
    mo.ui.table(_t)
    return


@app.cell
def _(mo):
    sql_input = mo.ui.text_area(
        label="SQL クエリ",
        value='SELECT "key", summary, status, priority, assignee FROM issues LIMIT 20',
        full_width=True,
    )
    sql_input
    return (sql_input,)


@app.cell
def _(db, mo, sql_input, sync_result):
    mo.stop(not sync_result, mo.md(""))
    _q = sql_input.value.strip()
    if _q:
        try:
            mo.ui.table(db.conn.execute(_q).fetchdf())
        except Exception as _e:
            mo.md(f"**エラー:** {_e}")
    return


if __name__ == "__main__":
    app.run()
