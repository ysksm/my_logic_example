import marimo

__generated_with = "0.21.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import os
    import asyncio
    from dotenv import load_dotenv

    load_dotenv()
    return asyncio, mo, os


@app.cell
def _(mo, os):
    CHROME_HOST = os.getenv("CHROME_DEBUG_HOST", "localhost")
    CHROME_PORT = int(os.getenv("CHROME_DEBUG_PORT", "9222"))
    DB_PATH = os.getenv("CHROME_DB_PATH", "./data/chrome_logs.duckdb")

    SSH_ENABLED = os.getenv("SSH_ENABLED", "false").lower() == "true"
    SSH_HOST = os.getenv("SSH_HOST", "")
    SSH_PORT = int(os.getenv("SSH_PORT", "22"))
    SSH_USER = os.getenv("SSH_USER", "") or None
    SSH_KEY = os.getenv("SSH_KEY", "") or None
    SSH_LOCAL_PORT = int(os.getenv("SSH_LOCAL_PORT", "9222"))
    SSH_REMOTE_PORT = int(os.getenv("SSH_REMOTE_PORT", "9222"))

    mo.md(f"""
    ## Chrome DevTools Remote Log Collector

    **接続先:** `{CHROME_HOST}:{CHROME_PORT}`
    **DB:** `{DB_PATH}`
    **SSH:** `{"有効" if SSH_ENABLED else "無効"}`{f" (`{SSH_USER + '@' if SSH_USER else ''}{SSH_HOST}:{SSH_PORT}`)" if SSH_ENABLED else ""}

    > Chromeを `--remote-debugging-port={CHROME_PORT}` で起動してください
    """)
    return (
        CHROME_HOST,
        CHROME_PORT,
        DB_PATH,
        SSH_ENABLED,
        SSH_HOST,
        SSH_KEY,
        SSH_LOCAL_PORT,
        SSH_PORT,
        SSH_REMOTE_PORT,
        SSH_USER,
    )


@app.cell
def _(DB_PATH):
    from chrome_logs.db import Database

    db = Database(DB_PATH)
    return (db,)


@app.cell
def _(SSH_ENABLED, mo):
    mo.stop(not SSH_ENABLED)
    ssh_password_input = mo.ui.text(
        label="SSHパスワード",
        kind="password",
    )
    ssh_start_btn = mo.ui.run_button(label="SSHトンネル開始")
    ssh_stop_btn = mo.ui.run_button(label="SSHトンネル停止")
    mo.vstack([
        mo.md("### SSHポートフォワード"),
        ssh_password_input,
        mo.hstack([ssh_start_btn, ssh_stop_btn]),
    ])
    return ssh_password_input, ssh_start_btn, ssh_stop_btn


@app.cell
def _(
    SSH_ENABLED,
    SSH_HOST,
    SSH_KEY,
    SSH_LOCAL_PORT,
    SSH_PORT,
    SSH_REMOTE_PORT,
    SSH_USER,
    mo,
    ssh_password_input,
    ssh_start_btn,
    ssh_stop_btn,
):
    mo.stop(not SSH_ENABLED)
    from chrome_logs.tunnel import SSHTunnel

    _password = ssh_password_input.value or None

    tunnel = SSHTunnel(
        ssh_host=SSH_HOST,
        remote_port=SSH_REMOTE_PORT,
        local_port=SSH_LOCAL_PORT,
        ssh_port=SSH_PORT,
        ssh_user=SSH_USER,
        ssh_password=_password,
        ssh_key=SSH_KEY,
    )

    if ssh_start_btn.value:
        try:
            tunnel.start()
            mo.md(f"**SSHトンネル開始:** `{tunnel}`")
        except Exception as e:
            mo.md(f"**SSHトンネルエラー:** `{e}`")

    if ssh_stop_btn.value:
        tunnel.stop()
        mo.md("**SSHトンネル停止しました**")
    return


@app.cell
def _(CHROME_HOST, CHROME_PORT, SSH_ENABLED, SSH_LOCAL_PORT):
    from chrome_logs.client import CDPClient

    _cdp_host = "localhost" if SSH_ENABLED else CHROME_HOST
    _cdp_port = SSH_LOCAL_PORT if SSH_ENABLED else CHROME_PORT
    client = CDPClient(host=_cdp_host, port=_cdp_port)
    return (client,)


@app.cell
def _(mo):
    get_target_options, set_target_options = mo.state({})
    return get_target_options, set_target_options


@app.cell
def _(mo):
    connect_btn = mo.ui.run_button(label="接続確認")
    connect_btn
    return (connect_btn,)


@app.cell
def _(client, connect_btn, mo, set_target_options):
    mo.stop(not connect_btn.value, mo.md("「接続確認」を押してターゲットを取得してください"))

    try:
        _targets = client.get_page_targets()
        _options = {
            f"{t.get('title', 'untitled')} ({t.get('url', '')[:60]})": t["id"]
            for t in _targets
        }
        set_target_options(_options)
        if not _options:
            mo.md("**ページターゲットが見つかりません。** Chromeでページを開いてください。")
        else:
            mo.md(f"**{len(_options)}件** のページが見つかりました")
    except Exception as e:
        set_target_options({})
        mo.md(f"**接続エラー:** `{e}`\n\nChromeが `--remote-debugging-port` で起動されているか確認してください。")
    return


@app.cell
def _(get_target_options, mo):
    _target_options = get_target_options()
    target_dropdown = mo.ui.dropdown(
        options=_target_options,
        label="ターゲットページ",
    )
    target_dropdown if _target_options else mo.md("「接続確認」を押してターゲットを取得してください")
    return (target_dropdown,)


@app.cell
def _(mo, target_dropdown):
    duration_input = mo.ui.number(
        value=30, start=5, stop=600, step=5, label="収集時間 (秒)"
    )
    collect_btn = mo.ui.run_button(label="ログ収集開始")
    mo.hstack([duration_input, collect_btn]) if target_dropdown.value else mo.md("ターゲットページを選択してください")
    return collect_btn, duration_input


@app.cell
def _(asyncio, client, collect_btn, db, duration_input, mo, target_dropdown):
    mo.stop(not collect_btn.value or not target_dropdown.value)

    from chrome_logs.collector import LogCollector

    _collector = LogCollector(client, db)

    async def _run():
        await _collector.start(target_id=target_dropdown.value)
        await _collector.collect(duration=duration_input.value)
        await _collector.stop()
        return _collector.stats

    _stats = asyncio.run(_run())
    mo.md(f"""
    ### 収集完了

    | 項目 | 件数 |
    |------|------|
    | コンソールログ | {_stats['console_logs']} |
    | ネットワークリクエスト | {_stats['network_requests']} |
    | ページエラー | {_stats['page_errors']} |

    **セッションID:** `{_collector.session_id}`
    """)
    return


@app.cell
def _(mo):
    mo.md("""
    ---
    ## 保存済みデータの閲覧
    """)
    return


@app.cell
def _(mo):
    refresh_btn = mo.ui.run_button(label="データ更新")
    refresh_btn
    return (refresh_btn,)


@app.cell
def _(db, mo, refresh_btn):
    mo.stop(not refresh_btn.value, mo.md("「データ更新」を押してセッション一覧を表示"))
    sessions_df = db.query("""
        SELECT session_id, started_at, ended_at, target_url, target_title
        FROM sessions ORDER BY started_at DESC LIMIT 20
    """)
    mo.stop(sessions_df.empty, mo.md("まだセッションがありません。ログ収集を実行してください。"))
    mo.ui.table(sessions_df, label="セッション一覧")
    return (sessions_df,)


@app.cell
def _(mo, sessions_df):
    mo.stop(sessions_df.empty, mo.md(""))
    _session_opts = {
        f"{r.session_id} - {r.target_title or r.target_url or 'N/A'}": r.session_id
        for r in sessions_df.itertuples()
    }
    session_select = mo.ui.dropdown(
        options=_session_opts,
        label="セッション選択",
    )
    session_select
    return (session_select,)


@app.cell
def _(db, mo, session_select):
    mo.stop(not session_select.value)

    _logs = db.query(f"""
        SELECT timestamp, level, message, url, line_number
        FROM console_logs
        WHERE session_id = '{session_select.value}'
        ORDER BY timestamp DESC
        LIMIT 200
    """)
    mo.accordion({
        f"コンソールログ ({len(_logs)}件)": mo.ui.table(_logs) if not _logs.empty else mo.md("なし"),
    })
    return


@app.cell
def _(db, mo, session_select):
    mo.stop(not session_select.value)

    _reqs = db.query(f"""
        SELECT timestamp, method, url, status_code, mime_type,
               encoded_data_length as size_bytes
        FROM network_requests
        WHERE session_id = '{session_select.value}'
        ORDER BY timestamp DESC
        LIMIT 200
    """)
    mo.accordion({
        f"ネットワークリクエスト ({len(_reqs)}件)": mo.ui.table(_reqs) if not _reqs.empty else mo.md("なし"),
    })
    return


@app.cell
def _(db, mo, session_select):
    mo.stop(not session_select.value)

    _errors = db.query(f"""
        SELECT timestamp, error_type, message, url, line_number
        FROM page_errors
        WHERE session_id = '{session_select.value}'
        ORDER BY timestamp DESC
        LIMIT 200
    """)
    mo.accordion({
        f"ページエラー ({len(_errors)}件)": mo.ui.table(_errors) if not _errors.empty else mo.md("なし"),
    })
    return


@app.cell
def _():
    import altair as alt

    return (alt,)


@app.cell
def _(mo):
    mo.md("""
    ---
    ## 分析
    """)
    return


@app.cell
def _(alt, db, mo, session_select):
    mo.stop(not session_select.value)

    _level_counts = db.query(f"""
        SELECT level, COUNT(*) as count
        FROM console_logs
        WHERE session_id = '{session_select.value}'
        GROUP BY level
        ORDER BY count DESC
    """)
    mo.stop(_level_counts.empty, mo.md("コンソールログがありません"))
    _chart = alt.Chart(_level_counts).mark_bar().encode(
        x="level:N",
        y="count:Q",
        color="level:N",
    ).properties(title="ログレベル分布", width=400)
    mo.ui.altair_chart(_chart)
    return


@app.cell
def _(alt, db, mo, session_select):
    mo.stop(not session_select.value)

    _status_counts = db.query(f"""
        SELECT
            CASE
                WHEN status_code BETWEEN 200 AND 299 THEN '2xx'
                WHEN status_code BETWEEN 300 AND 399 THEN '3xx'
                WHEN status_code BETWEEN 400 AND 499 THEN '4xx'
                WHEN status_code BETWEEN 500 AND 599 THEN '5xx'
                ELSE 'other'
            END as status_group,
            COUNT(*) as count
        FROM network_requests
        WHERE session_id = '{session_select.value}'
        GROUP BY status_group
        ORDER BY status_group
    """)
    mo.stop(_status_counts.empty, mo.md("ネットワークリクエストがありません"))
    _chart = alt.Chart(_status_counts).mark_arc().encode(
        theta="count:Q",
        color="status_group:N",
    ).properties(title="HTTPステータス分布", width=400)
    mo.ui.altair_chart(_chart)
    return


@app.cell
def _(mo):
    mo.md("""
    ---
    ## カスタムSQL
    """)
    return


@app.cell
def _(mo):
    sql_input = mo.ui.text_area(
        value="SELECT * FROM console_logs ORDER BY timestamp DESC LIMIT 10",
        label="SQL",
        full_width=True,
    )
    sql_run_btn = mo.ui.run_button(label="実行")
    mo.vstack([sql_input, sql_run_btn])
    return sql_input, sql_run_btn


@app.cell
def _(db, mo, sql_input, sql_run_btn):
    mo.stop(not sql_run_btn.value)
    try:
        _result = db.query(sql_input.value)
        mo.ui.table(_result)
    except Exception as e:
        mo.md(f"**SQLエラー:** `{e}`")
    return


if __name__ == "__main__":
    app.run()
