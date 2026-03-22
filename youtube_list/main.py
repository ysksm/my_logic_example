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
    # YouTube List

    YouTube チャンネル・動画データを DuckDB に同期し、可視化するノートブックです。

    ## 環境変数

    `.env` ファイルまたはシェルで設定:

    | 変数 | 必須 | 説明 |
    |------|------|------|
    | `YOUTUBE_API_KEY` | Yes | YouTube Data API v3 キー |
    | `YOUTUBE_DB_PATH` | No | DB パス (default: `./data/youtube.duckdb`) |
    | `YOUTUBE_CHANNEL_IDS` | No | 初期同期するチャンネル ID（カンマ区切り） |
    | `YOUTUBE_AUTO_SYNC` | No | `full` で自動同期 |
    | `YOUTUBE_MAX_VIDEOS` | No | チャンネルあたりの最大動画数 (default: 0=全件) |
    """)
    return


@app.cell
def _():
    import os
    import time
    import traceback

    import pandas as pd
    from dotenv import load_dotenv

    from youtube_sync import YouTubeClient, Database, SyncService, SyncState

    load_dotenv(override=False)

    YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
    YOUTUBE_DB_PATH = os.environ.get("YOUTUBE_DB_PATH", "./data/youtube.duckdb")
    YOUTUBE_CHANNEL_IDS = os.environ.get("YOUTUBE_CHANNEL_IDS", "")
    YOUTUBE_AUTO_SYNC = os.environ.get("YOUTUBE_AUTO_SYNC", "").lower() in (
        "1", "true", "yes", "full",
    )
    YOUTUBE_MAX_VIDEOS = int(os.environ.get("YOUTUBE_MAX_VIDEOS", "0"))
    return (
        Database,
        SyncService,
        SyncState,
        YOUTUBE_API_KEY,
        YOUTUBE_AUTO_SYNC,
        YOUTUBE_CHANNEL_IDS,
        YOUTUBE_DB_PATH,
        YOUTUBE_MAX_VIDEOS,
        YouTubeClient,
        os,
        pd,
        time,
        traceback,
    )


@app.cell
def _(
    Database,
    SyncState,
    YOUTUBE_API_KEY,
    YOUTUBE_AUTO_SYNC,
    YOUTUBE_CHANNEL_IDS,
    YOUTUBE_DB_PATH,
    YouTubeClient,
    mo,
    os,
):
    # リフレッシュ用 state: 値が変わると下流セルが再実行される
    get_refresh, set_refresh = mo.state(0)

    if not YOUTUBE_API_KEY:
        mo.md("**環境変数 `YOUTUBE_API_KEY` が未設定です。** `.env` ファイルを確認してください。")
        client = None
        db = None
        sync_state = None
    else:
        client = YouTubeClient(YOUTUBE_API_KEY)
        db = Database(YOUTUBE_DB_PATH)
        sync_state = SyncState(
            os.path.join(os.path.dirname(YOUTUBE_DB_PATH) or ".", "sync_state.json")
        )

        _info = f"DB: `{YOUTUBE_DB_PATH}`"
        if YOUTUBE_CHANNEL_IDS:
            _info += f" | 初期チャンネル: **{len(YOUTUBE_CHANNEL_IDS.split(','))}** 件"
        if YOUTUBE_AUTO_SYNC:
            _info += " | Auto: **full**"
        mo.md(_info)
    return client, db, get_refresh, set_refresh, sync_state


@app.cell
def _(mo):
    mo.md("""
    ## 1. チャンネル追加
    """)
    return


@app.cell
def _(mo):
    channel_input = mo.ui.text(
        label="YouTube URL またはチャンネル ID",
        placeholder="https://youtube.com/@handle or UCxxxxxx",
        full_width=True,
    )
    add_btn = mo.ui.run_button(label="チャンネル追加")
    mo.hstack([channel_input, add_btn], gap=1, widths=[3, 1])
    return add_btn, channel_input


@app.cell
def _(
    SyncService,
    YOUTUBE_MAX_VIDEOS,
    add_btn,
    channel_input,
    client,
    db,
    mo,
    set_refresh,
    sync_state,
    time,
    traceback,
):
    # run_button: クリックまでこのセルは停止。return なしなので下流に影響しない
    if client is not None and channel_input.value.strip():
        _logs = []

        def _on_log(msg):
            _logs.append(msg)
            mo.output.replace(mo.md(
                f"**処理中...**\n\n```\n" + "\n".join(_logs) + "\n```"
            ))

        _svc = SyncService(client, db, sync_state)
        try:
            _result = _svc.add_channel(
                channel_input.value.strip(), YOUTUBE_MAX_VIDEOS, on_log=_on_log,
            )
            _logs.append(f"完了: {_result['title']} (動画 {_result['videos_fetched']} 件)")
            set_refresh(time.time())
            mo.md(
                f"**チャンネル追加完了:** {_result['title']}\n\n"
                f"- チャンネル ID: `{_result['channel_id']}`\n"
                f"- 動画取得数: **{_result['videos_fetched']}** 件\n\n"
                f"<details><summary>実行ログ ({len(_logs)} 行)</summary>\n\n"
                f"```\n" + "\n".join(_logs) + "\n```\n\n</details>"
            )
        except Exception as _e:
            _tb = traceback.format_exc()
            _logs.append(f"エラー: {_e}")
            mo.md(
                f"**エラー:** {_e}\n\n"
                f"<details><summary>実行ログ ({len(_logs)} 行)</summary>\n\n"
                f"```\n" + "\n".join(_logs) + "\n```\n\n</details>\n\n"
                f"<details><summary>トレースバック</summary>\n\n"
                f"```\n{_tb}\n```\n\n</details>"
            )
    else:
        mo.md("URL またはチャンネル ID を入力してボタンを押してください")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 2. 同期実行
    """)
    return


@app.cell
def _(mo, sync_state):
    if sync_state is not None:
        _last = sync_state.get_last_sync()
        if _last:
            mo.md(
                f"前回同期: **{_last['completed_at']}** "
                f"({_last['sync_type']}, {_last['channels_synced']}ch / {_last['videos_synced']}動画)"
            )
        else:
            mo.md("前回同期: なし")
    else:
        mo.md("")
    return


@app.cell
def _(YOUTUBE_AUTO_SYNC, mo):
    sync_btn = mo.ui.run_button(label="全チャンネル同期")
    if YOUTUBE_AUTO_SYNC:
        mo.md("**自動同期モード**")
    else:
        sync_btn
    return (sync_btn,)


@app.cell
def _(
    SyncService,
    YOUTUBE_AUTO_SYNC,
    YOUTUBE_CHANNEL_IDS,
    YOUTUBE_MAX_VIDEOS,
    client,
    db,
    mo,
    set_refresh,
    sync_btn,
    sync_state,
    time,
    traceback,
):
    if client is not None:
        _svc = SyncService(client, db, sync_state)

        # 初期チャンネルの自動追加
        _init_errors = []
        if YOUTUBE_CHANNEL_IDS:
            _existing = set(db.get_channel_ids())
            for _ch_id in YOUTUBE_CHANNEL_IDS.split(","):
                _ch_id = _ch_id.strip()
                if _ch_id and _ch_id not in _existing:
                    mo.output.replace(mo.md(f"初期チャンネルを追加中: `{_ch_id}`..."))
                    try:
                        _svc.add_channel(_ch_id, YOUTUBE_MAX_VIDEOS)
                    except Exception as _e:
                        _init_errors.append(f"{_ch_id}: {_e}")
            if _init_errors:
                mo.output.replace(mo.md(
                    "**初期チャンネル追加エラー:**\n" +
                    "\n".join(f"- {e}" for e in _init_errors)
                ))

        if (sync_btn.value or 0) > 0 or YOUTUBE_AUTO_SYNC:
            _logs = []

            def _on_log(msg):
                _logs.append(msg)
                mo.output.replace(mo.md(
                    f"**同期中...**\n\n```\n" + "\n".join(_logs[-10:]) + "\n```"
                ))

            mo.output.replace(mo.md("**同期を開始...**"))
            try:
                _sync_result = _svc.sync_all(
                    max_videos=YOUTUBE_MAX_VIDEOS,
                    on_log=_on_log,
                )
                _s = _sync_result["summary"]
                _errors = _sync_result.get("errors", [])
                _error_section = ""
                if _errors:
                    _error_section = (
                        f"\n\n**エラー ({len(_errors)} 件):**\n"
                        + "\n".join(f"- {e}" for e in _errors)
                    )
                set_refresh(time.time())
                mo.md(
                    f"**同期完了**\n\n"
                    f"- チャンネル: **{_s['channels']}** 件\n"
                    f"- 動画: **{_s['videos']}** 件"
                    f"{_error_section}\n\n"
                    f"<details><summary>実行ログ ({len(_logs)} 行)</summary>\n\n"
                    f"```\n" + "\n".join(_logs) + "\n```\n\n</details>"
                )
            except Exception as _e:
                _tb = traceback.format_exc()
                _logs.append(f"エラー: {_e}")
                mo.md(
                    f"**同期エラー:** {_e}\n\n"
                    f"<details><summary>実行ログ ({len(_logs)} 行)</summary>\n\n"
                    f"```\n" + "\n".join(_logs) + "\n```\n\n</details>\n\n"
                    f"<details><summary>トレースバック</summary>\n\n"
                    f"```\n{_tb}\n```\n\n</details>"
                )
        else:
            mo.md("")
    else:
        mo.md("")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 3. チャンネル一覧
    """)
    return


@app.cell
def _(db, get_refresh, mo):
    _v = get_refresh()
    channel_table = None
    if db is not None:
        _channels = db.conn.execute("""
            SELECT id, title, subscriber_count, video_count, view_count, country
            FROM channels ORDER BY subscriber_count DESC
        """).fetchdf()
        if _channels.empty:
            mo.md("チャンネルが登録されていません。上の入力欄からチャンネルを追加してください。")
        else:
            channel_table = mo.ui.table(_channels, label="登録チャンネル", selection="single")
            channel_table
    else:
        mo.md("")
    return (channel_table,)


@app.cell
def _(mo):
    mo.md("""
    ## 4. 動画一覧
    """)
    return


@app.cell
def _(db, get_refresh, mo):
    _v = get_refresh()
    if db is not None:
        _videos = db.conn.execute("""
            SELECT
                v.title as 動画タイトル,
                c.title as チャンネル,
                v.view_count as 再生数,
                v.like_count as いいね数,
                v.comment_count as コメント数,
                v.published_at as 公開日,
                v.id as video_id
            FROM videos v
            JOIN channels c ON v.channel_id = c.id
            ORDER BY v.published_at DESC
        """).fetchdf()

        if not _videos.empty:
            mo.vstack([
                mo.md(f"**全動画: {len(_videos)} 件**"),
                mo.ui.table(_videos, page_size=20),
            ])
        else:
            mo.md("動画データがありません")
    else:
        mo.md("")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 5. 可視化
    """)
    return


@app.cell
def _(db, get_refresh, mo):
    _v = get_refresh()
    import altair as alt

    if db is not None:
        _ch = db.conn.execute("""
            SELECT title, subscriber_count FROM channels
            ORDER BY subscriber_count DESC LIMIT 20
        """).fetchdf()

        if not _ch.empty:
            _c1 = alt.Chart(_ch).mark_bar().encode(
                x=alt.X("subscriber_count:Q", title="登録者数"),
                y=alt.Y("title:N", sort="-x", title="チャンネル"),
                color=alt.Color("title:N", legend=None),
            ).properties(title="登録者数ランキング", width=600, height=max(len(_ch) * 25, 100))

            _vw = db.conn.execute("""
                SELECT title, view_count FROM channels
                ORDER BY view_count DESC LIMIT 20
            """).fetchdf()

            _c2 = alt.Chart(_vw).mark_bar().encode(
                x=alt.X("view_count:Q", title="総再生数"),
                y=alt.Y("title:N", sort="-x", title="チャンネル"),
                color=alt.Color("title:N", legend=None),
            ).properties(title="総再生数ランキング", width=600, height=max(len(_vw) * 25, 100))

            mo.vstack([mo.as_html(_c1), mo.as_html(_c2)])
        else:
            mo.md("")
    else:
        mo.md("")
    return (alt,)


@app.cell
def _(alt, db, get_refresh, mo):
    _v = get_refresh()
    if db is not None:
        _top = db.conn.execute("""
            SELECT v.title, v.view_count, v.like_count, c.title as channel
            FROM videos v JOIN channels c ON v.channel_id = c.id
            ORDER BY v.view_count DESC LIMIT 20
        """).fetchdf()

        if not _top.empty:
            _c = alt.Chart(_top).mark_bar().encode(
                x=alt.X("view_count:Q", title="再生数"),
                y=alt.Y("title:N", sort="-x", title="動画"),
                color=alt.Color("channel:N", title="チャンネル"),
                tooltip=["title:N", "view_count:Q", "like_count:Q", "channel:N"],
            ).properties(title="動画再生数 Top 20", width=700, height=500)
            mo.as_html(_c)
        else:
            mo.md("")
    else:
        mo.md("")
    return


@app.cell
def _(alt, db, get_refresh, mo):
    _v = get_refresh()
    if db is not None:
        _vc = db.conn.execute("""
            SELECT c.title, COUNT(*) as count
            FROM videos v JOIN channels c ON v.channel_id = c.id
            GROUP BY c.title ORDER BY count DESC
        """).fetchdf()

        if not _vc.empty:
            _c = alt.Chart(_vc).mark_arc(innerRadius=50).encode(
                theta="count:Q",
                color=alt.Color("title:N", title="チャンネル"),
                tooltip=["title:N", "count:Q"],
            ).properties(title="チャンネル別動画数", width=400, height=300)
            mo.as_html(_c)
        else:
            mo.md("")
    else:
        mo.md("")
    return


@app.cell
def _(alt, db, get_refresh, mo):
    _v = get_refresh()
    if db is not None:
        _monthly = db.conn.execute("""
            SELECT STRFTIME(CAST(published_at AS TIMESTAMP), '%Y-%m') as month, COUNT(*) as count
            FROM videos WHERE published_at IS NOT NULL
            GROUP BY month ORDER BY month
        """).fetchdf()

        if not _monthly.empty:
            _c = alt.Chart(_monthly).mark_line(point=True).encode(
                x=alt.X("month:T", title="月"),
                y=alt.Y("count:Q", title="公開数"),
                tooltip=["month:T", "count:Q"],
            ).properties(title="月別動画公開数", width=700, height=300)
            mo.as_html(_c)
        else:
            mo.md("")
    else:
        mo.md("")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 6. チャンネル詳細
    """)
    return


@app.cell
def _(channel_table, db, mo, pd):
    if channel_table is not None:
        _sel = channel_table.value
        if isinstance(_sel, pd.DataFrame) and not _sel.empty:
            _ch_id = _sel.iloc[0]["id"]
            _videos = db.conn.execute("""
                SELECT title, view_count, like_count, comment_count, published_at
                FROM videos WHERE channel_id = ?
                ORDER BY view_count DESC
            """, [_ch_id]).fetchdf()
            mo.vstack([
                mo.md(f"### {_sel.iloc[0]['title']} の動画一覧 ({len(_videos)} 件)"),
                mo.ui.table(_videos),
            ])
        else:
            mo.md("チャンネル一覧からチャンネルを選択してください")
    else:
        mo.md("")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 7. 履歴データ
    """)
    return


@app.cell
def _(alt, db, get_refresh, mo):
    _v = get_refresh()
    if db is not None:
        _hist = db.conn.execute("""
            SELECT ch.recorded_at, c.title,
                   ch.subscriber_count, ch.video_count, ch.view_count
            FROM channel_history ch
            JOIN channels c ON ch.channel_id = c.id
            ORDER BY ch.recorded_at
        """).fetchdf()

        if not _hist.empty and len(_hist) > 1:
            _c = alt.Chart(_hist).mark_line(point=True).encode(
                x=alt.X("recorded_at:T", title="日時"),
                y=alt.Y("subscriber_count:Q", title="登録者数"),
                color=alt.Color("title:N", title="チャンネル"),
                tooltip=["title:N", "subscriber_count:Q", "recorded_at:T"],
            ).properties(title="登録者数推移", width=700, height=350)
            mo.as_html(_c)
        else:
            mo.md("履歴データが不足しています（複数回同期すると推移が表示されます）")
    else:
        mo.md("")
    return


@app.cell
def _(mo):
    mo.md("""
    ## 8. SQL クエリ
    """)
    return


@app.cell
def _(db, get_refresh, mo):
    _v = get_refresh()
    if db is not None:
        _t = db.conn.execute(
            "SELECT table_name, estimated_size FROM duckdb_tables() ORDER BY table_name"
        ).fetchdf()
        mo.ui.table(_t)
    else:
        mo.md("")
    return


@app.cell
def _(mo):
    sql_input = mo.ui.text_area(
        label="SQL クエリ",
        value="SELECT title, subscriber_count, video_count FROM channels ORDER BY subscriber_count DESC LIMIT 20",
        full_width=True,
    )
    sql_input
    return (sql_input,)


@app.cell
def _(db, get_refresh, mo, sql_input):
    _v = get_refresh()
    if db is not None:
        _q = sql_input.value.strip()
        if _q:
            try:
                mo.ui.table(db.conn.execute(_q).fetchdf())
            except Exception as _e:
                mo.md(f"**エラー:** {_e}")
        else:
            mo.md("")
    else:
        mo.md("")
    return


if __name__ == "__main__":
    app.run()
