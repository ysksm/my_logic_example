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
    | `YOUTUBE_CHANNEL_IDS` | No | 同期するチャンネル（カンマ区切り URL/ID） |
    | `YOUTUBE_AUTO_SYNC` | No | `full` で自動同期 |
    | `YOUTUBE_MAX_VIDEOS` | No | チャンネルあたりの最大動画数 (default: 0=全件) |
    """)
    return


@app.cell
def _():
    import os

    import pandas as pd
    from dotenv import load_dotenv

    from youtube_sync import YouTubeClient, Database, SyncService
    from youtube_sync.sync import SyncState

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
    _missing = []
    if not YOUTUBE_API_KEY:
        _missing.append("YOUTUBE_API_KEY")
    mo.stop(bool(_missing), mo.md(
        f"**環境変数が未設定です:** {', '.join(_missing)}"
    ))

    client = YouTubeClient(YOUTUBE_API_KEY)
    db = Database(YOUTUBE_DB_PATH)
    sync_state = SyncState(
        os.path.join(os.path.dirname(YOUTUBE_DB_PATH) or ".", "sync_state.json")
    )

    _info = f"DB: `{YOUTUBE_DB_PATH}`"
    if YOUTUBE_CHANNEL_IDS:
        _info += f" | チャンネル: **{len(YOUTUBE_CHANNEL_IDS.split(','))}** 件"
    if YOUTUBE_AUTO_SYNC:
        _info += " | Auto: **full**"
    mo.md(_info)
    return client, db, sync_state


@app.cell
def _(mo):
    mo.md("""
    ## 1. チャンネル入力
    """)
    return


@app.cell
def _(YOUTUBE_CHANNEL_IDS, db, mo):
    # DB に登録済みのチャンネル ID を取得
    _existing = db.get_channel_ids()
    # 環境変数の新規チャンネルを追加
    _env_channels = [ch.strip() for ch in YOUTUBE_CHANNEL_IDS.split(",") if ch.strip()]
    _all = list(dict.fromkeys(_existing + _env_channels))  # 重複除去・順序保持

    channel_text = mo.ui.text_area(
        label="同期するチャンネル（URL または ID、1行1件）",
        value="\n".join(_all),
        full_width=True,
    )
    channel_text
    return (channel_text,)


@app.cell
def _(mo):
    mo.md("""
    ## 2. 同期実行
    """)
    return


@app.cell
def _(mo):
    sync_btn = mo.ui.run_button(label="同期実行")
    sync_btn
    return (sync_btn,)


@app.cell
def _(
    SyncService,
    YOUTUBE_AUTO_SYNC,
    YOUTUBE_MAX_VIDEOS,
    channel_text,
    client,
    db,
    mo,
    sync_btn,
    sync_state,
):
    mo.stop(not (sync_btn.value or YOUTUBE_AUTO_SYNC), mo.md("同期ボタンを押してください"))

    _channels = [ch.strip() for ch in channel_text.value.strip().split("\n") if ch.strip()]
    mo.stop(not _channels, mo.md("チャンネルを入力してください"))

    _svc = SyncService(client, db, sync_state)

    # チャンネル追加
    _logs = []
    for _i, _ch in enumerate(_channels):
        mo.output.replace(mo.md(f"**チャンネル追加中...** {_i + 1}/{len(_channels)}: `{_ch}`"))
        try:
            _result = _svc.add_channel(_ch, YOUTUBE_MAX_VIDEOS)
            _logs.append(f"{_result['title']}: 動画 {_result['videos_fetched']} 件")
        except Exception as _e:
            _logs.append(f"{_ch}: エラー - {_e}")

    # 全チャンネル同期
    mo.output.replace(mo.md("**全チャンネル同期中...**"))

    def _on_log(msg):
        mo.output.replace(mo.md(f"**同期中...**\n\n`{msg}`"))

    sync_result = _svc.sync_all(max_videos=YOUTUBE_MAX_VIDEOS, on_log=_on_log)

    _s = sync_result["summary"]
    _errors = sync_result.get("errors", [])
    _error_section = ""
    if _errors:
        _error_section = "\n\n**エラー:**\n" + "\n".join(f"- {e}" for e in _errors)

    mo.md(
        f"**同期完了**\n\n"
        f"- チャンネル: **{_s['channels']}** 件\n"
        f"- 動画: **{_s['videos']}** 件"
        f"{_error_section}\n\n"
        f"<details><summary>チャンネル追加ログ ({len(_logs)} 件)</summary>\n\n"
        + "\n".join(f"- {l}" for l in _logs) +
        "\n\n</details>"
    )
    return (sync_result,)


@app.cell
def _(mo):
    mo.md("""
    ## 3. チャンネル一覧
    """)
    return


@app.cell
def _(db, mo, sync_result):
    mo.stop(not sync_result, mo.md(""))
    _channels = db.conn.execute("""
        SELECT id, title, subscriber_count, video_count, view_count, country
        FROM channels ORDER BY subscriber_count DESC
    """).fetchdf()
    channel_table = mo.ui.table(_channels, label="登録チャンネル", selection="single")
    channel_table
    return (channel_table,)


@app.cell
def _(mo):
    mo.md("""
    ## 4. 動画一覧
    """)
    return


@app.cell
def _(db, mo, sync_result):
    mo.stop(not sync_result, mo.md(""))
    _videos = db.conn.execute("""
        SELECT
            v.title as 動画タイトル,
            c.title as チャンネル,
            v.view_count as 再生数,
            v.like_count as いいね数,
            v.comment_count as コメント数,
            v.published_at as 公開日
        FROM videos v
        JOIN channels c ON v.channel_id = c.id
        ORDER BY v.published_at DESC
    """).fetchdf()
    mo.vstack([
        mo.md(f"**全動画: {len(_videos)} 件**"),
        mo.ui.table(_videos, page_size=20),
    ])
    return


@app.cell
def _(mo):
    mo.md("""
    ## 5. 可視化
    """)
    return


@app.cell
def _(db, mo, sync_result):
    mo.stop(not sync_result, mo.md(""))
    import altair as alt

    _ch = db.conn.execute("""
        SELECT title, subscriber_count FROM channels
        ORDER BY subscriber_count DESC LIMIT 20
    """).fetchdf()
    _vw = db.conn.execute("""
        SELECT title, view_count FROM channels
        ORDER BY view_count DESC LIMIT 20
    """).fetchdf()

    _c1 = alt.Chart(_ch).mark_bar().encode(
        x=alt.X("subscriber_count:Q", title="登録者数"),
        y=alt.Y("title:N", sort="-x", title="チャンネル"),
        color=alt.Color("title:N", legend=None),
    ).properties(title="登録者数ランキング", width=600, height=max(len(_ch) * 25, 100))

    _c2 = alt.Chart(_vw).mark_bar().encode(
        x=alt.X("view_count:Q", title="総再生数"),
        y=alt.Y("title:N", sort="-x", title="チャンネル"),
        color=alt.Color("title:N", legend=None),
    ).properties(title="総再生数ランキング", width=600, height=max(len(_vw) * 25, 100))

    mo.vstack([mo.as_html(_c1), mo.as_html(_c2)])
    return (alt,)


@app.cell
def _(alt, db, mo):
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
    return


@app.cell
def _(alt, db, mo):
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
    return


@app.cell
def _(alt, db, mo):
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
    return


@app.cell
def _(mo):
    mo.md("""
    ## 6. チャンネル詳細
    """)
    return


@app.cell
def _(channel_table, db, mo, pd):
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
    return


@app.cell
def _(mo):
    mo.md("""
    ## 7. 履歴データ
    """)
    return


@app.cell
def _(alt, db, mo, sync_result):
    mo.stop(not sync_result, mo.md(""))
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
    return


@app.cell
def _(mo):
    mo.md("""
    ## 8. SQL クエリ
    """)
    return


@app.cell
def _(db, mo, sync_result):
    mo.stop(not sync_result, mo.md(""))
    _t = db.conn.execute(
        "SELECT table_name, estimated_size FROM duckdb_tables() ORDER BY table_name"
    ).fetchdf()
    mo.ui.table(_t)
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
