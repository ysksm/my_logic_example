"""Claude Code 利用状況 探索ダッシュボード (marimo)

  uv run marimo edit app.py     # 編集モード（探索向け・セルを自由に追加）
  uv run marimo run  app.py     # アプリモード（閲覧用）

事前に `uv run python build_db.py` で claude_usage.duckdb を生成しておくこと。
"""

import marimo

app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo
    import duckdb
    import polars as pl
    import plotly.express as px
    return duckdb, mo, pl, px


@app.cell
def _(mo):
    mo.md(
        """
        # 🔍 Claude Code 利用状況ダッシュボード

        `~/.claude/projects` のセッション履歴を探索的に分析します。
        左のフィルタ（期間・プロジェクト・モデル）を変えると全グラフが連動します。
        """
    )
    return


@app.cell
def _(mo):
    db_path = mo.ui.text(value="claude_usage.duckdb", label="DuckDB ファイル", full_width=True)
    db_path
    return (db_path,)


@app.cell
def _(db_path, duckdb, mo):
    import os as _os
    if not _os.path.exists(db_path.value):
        con = None
        mo.stop(
            True,
            mo.md(
                f"⚠️ `{db_path.value}` が見つかりません。先に "
                "`uv run python build_db.py` を実行してください。"
            ),
        )
    else:
        con = duckdb.connect(db_path.value, read_only=True)
    return (con,)


@app.cell
def _(con, pl):
    events = (
        con.execute("SELECT * FROM events").pl()
        .with_columns(pl.col("timestamp").dt.date().alias("date"))
    )
    tool_calls_raw = con.execute("SELECT * FROM tool_calls").pl()
    if "call_ts" in tool_calls_raw.columns and tool_calls_raw.height:
        tool_calls_raw = tool_calls_raw.with_columns(pl.col("call_ts").dt.date().alias("date"))
    prompts_raw = con.execute("SELECT * FROM prompts").pl()
    if "timestamp" in prompts_raw.columns and prompts_raw.height:
        prompts_raw = prompts_raw.with_columns(pl.col("timestamp").dt.date().alias("date"))
    return events, prompts_raw, tool_calls_raw


@app.cell
def _(events, mo):
    _projects = sorted([p for p in events["project"].unique().to_list() if p])
    _models = sorted([m for m in events["model"].unique().to_list() if m])
    _dates = events["date"].drop_nulls()
    _dmin = _dates.min()
    _dmax = _dates.max()

    proj_sel = mo.ui.multiselect(options=_projects, value=_projects, label="プロジェクト")
    model_sel = mo.ui.multiselect(options=_models, value=_models, label="モデル")
    sub_chk = mo.ui.checkbox(value=False, label="サブエージェントを含める")
    d_start = mo.ui.date(value=_dmin, label="開始日")
    d_end = mo.ui.date(value=_dmax, label="終了日")

    mo.vstack([
        mo.md("### フィルタ"),
        mo.hstack([d_start, d_end, sub_chk], justify="start", gap=2),
        proj_sel,
        model_sel,
    ])
    return d_end, d_start, model_sel, proj_sel, sub_chk


@app.cell
def _(d_end, d_start, model_sel, pl, proj_sel, sub_chk):
    def flt(df):
        if df.is_empty():
            return df
        out = df
        if "date" in out.columns:
            out = out.filter(
                (pl.col("date") >= d_start.value) & (pl.col("date") <= d_end.value)
            )
        if "project" in out.columns:
            out = out.filter(pl.col("project").is_in(proj_sel.value))
        if "is_subagent" in out.columns and not sub_chk.value:
            out = out.filter(~pl.col("is_subagent"))
        if "model" in out.columns:
            out = out.filter(
                pl.col("model").is_in(model_sel.value) | pl.col("model").is_null()
            )
        return out
    return (flt,)


@app.cell
def _(events, flt, prompts_raw, tool_calls_raw):
    ev = flt(events)
    tc = flt(tool_calls_raw)
    pr = flt(prompts_raw)
    return ev, pr, tc


@app.cell
def _(ev, mo, pr, tc):
    _cost = float(ev["cost_usd"].sum() or 0)
    _in = int(ev["input_tokens"].sum() or 0)
    _out = int(ev["output_tokens"].sum() or 0)
    _cr = int(ev["cache_read_tokens"].sum() or 0)
    _cw = int(ev["cache_creation_tokens"].sum() or 0)
    _tot_tok = _in + _out + _cr + _cw
    _sessions = ev["session_id"].n_unique()
    _err = tc.filter(tc["is_error"]).height if tc.height else 0
    _err_rate = (_err / tc.height * 100) if tc.height else 0

    mo.hstack([
        mo.stat(label="推定コスト", value=f"${_cost:,.2f}"),
        mo.stat(label="総トークン", value=f"{_tot_tok/1e6:,.1f}M"),
        mo.stat(label="セッション数", value=f"{_sessions:,}"),
        mo.stat(label="人間プロンプト", value=f"{pr.height:,}"),
        mo.stat(label="ツール呼び出し", value=f"{tc.height:,}"),
        mo.stat(label="ツールエラー率", value=f"{_err_rate:.1f}%"),
    ], justify="space-around", gap=1)
    return


@app.cell
def _(mo):
    mo.md("## 💰 コスト / トークン")
    return


@app.cell
def _(ev, mo, pl, px):
    _g = (
        ev.filter(pl.col("type") == "assistant")
        .group_by("date").agg(pl.col("cost_usd").sum())
        .sort("date")
    )
    _fig = px.bar(_g.to_pandas(), x="date", y="cost_usd",
                  title="日次コスト (USD)", labels={"cost_usd": "USD"})
    mo.ui.plotly(_fig)
    return


@app.cell
def _(ev, mo, pl, px):
    _g = (
        ev.filter(pl.col("type") == "assistant")
        .group_by("model").agg(pl.col("cost_usd").sum())
        .sort("cost_usd", descending=True)
    )
    _fig = px.bar(_g.to_pandas(), x="model", y="cost_usd",
                  title="モデル別コスト (USD)", labels={"cost_usd": "USD"})
    mo.ui.plotly(_fig)
    return


@app.cell
def _(ev, mo, pl, px):
    _sums = ev.select(
        pl.col("input_tokens").sum().alias("input"),
        pl.col("output_tokens").sum().alias("output"),
        pl.col("cache_read_tokens").sum().alias("cache_read"),
        pl.col("cache_creation_tokens").sum().alias("cache_creation"),
    )
    _long = _sums.unpivot(variable_name="種別", value_name="tokens")
    _fig = px.pie(_long.to_pandas(), names="種別", values="tokens",
                  title="トークン種別の内訳（キャッシュ効率の確認）", hole=0.4)
    mo.ui.plotly(_fig)
    return


@app.cell
def _(mo):
    mo.md("## 🛠️ ツール利用")
    return


@app.cell
def _(mo, pl, px, tc):
    _g = (
        tc.group_by("tool_name")
        .agg(
            pl.len().alias("calls"),
            pl.col("is_error").sum().alias("errors"),
        )
        .with_columns((pl.col("errors") / pl.col("calls") * 100).alias("error_rate"))
        .sort("calls", descending=True)
    )
    _fig = px.bar(_g.to_pandas(), x="tool_name", y="calls", color="error_rate",
                  color_continuous_scale="Reds",
                  title="ツール別 呼び出し回数（色=エラー率%）")
    mo.ui.plotly(_fig)
    return


@app.cell
def _(mo, pl, px, tc):
    _d = tc.filter(pl.col("duration_ms").is_not_null())
    if _d.height:
        _g = (
            _d.group_by("tool_name")
            .agg(
                pl.col("duration_ms").median().alias("median_ms"),
                pl.col("duration_ms").quantile(0.95).alias("p95_ms"),
            )
            .sort("p95_ms", descending=True)
        )
        _long = _g.unpivot(index="tool_name", variable_name="統計", value_name="ms")
        _fig = px.bar(_long.to_pandas(), x="tool_name", y="ms", color="統計",
                      barmode="group", title="ツール別 実行時間（中央値 / p95, ミリ秒）")
        _out = mo.ui.plotly(_fig)
    else:
        _out = mo.md("実行時間データがありません。")
    _out
    return


@app.cell
def _(mo):
    mo.md("## 📈 セッション / 生産性")
    return


@app.cell
def _(ev, mo, pl, px):
    _g = (
        ev.group_by("date")
        .agg(pl.col("session_id").n_unique().alias("sessions"))
        .sort("date")
    )
    _fig = px.line(_g.to_pandas(), x="date", y="sessions", markers=True,
                   title="日次アクティブセッション数")
    mo.ui.plotly(_fig)
    return


@app.cell
def _(ev, mo, pl, px):
    _sess = (
        ev.group_by("session_id")
        .agg(
            pl.col("timestamp").min().alias("start"),
            pl.col("timestamp").max().alias("end"),
            (pl.col("type") == "user").sum().alias("turns"),
        )
        .with_columns(
            ((pl.col("end") - pl.col("start")).dt.total_seconds() / 60).alias("duration_min")
        )
    )
    _fig = px.scatter(
        _sess.to_pandas(), x="duration_min", y="turns",
        title="セッション長(分) × 対話ターン数", labels={"turns": "ターン数"},
        hover_data=["session_id"],
    )
    mo.ui.plotly(_fig)
    return


@app.cell
def _(ev, mo, pl, px):
    _g = (
        ev.with_columns(pl.col("timestamp").dt.hour().alias("hour"))
        .filter(pl.col("type") == "user")
        .group_by("hour").agg(pl.len().alias("activity"))
        .sort("hour")
    )
    _fig = px.bar(_g.to_pandas(), x="hour", y="activity",
                  title="時間帯別の活動量（ユーザー操作）")
    mo.ui.plotly(_fig)
    return


@app.cell
def _(mo):
    mo.md("## 🗂️ プロジェクト横断")
    return


@app.cell
def _(ev, mo, pl, tc):
    _e = (
        ev.group_by("project")
        .agg(
            pl.col("session_id").n_unique().alias("sessions"),
            pl.col("cost_usd").sum().round(2).alias("cost_usd"),
            (pl.col("input_tokens") + pl.col("output_tokens")
             + pl.col("cache_read_tokens") + pl.col("cache_creation_tokens"))
            .sum().alias("tokens"),
        )
    )
    _t = tc.group_by("project").agg(pl.len().alias("tool_calls"))
    _tbl = _e.join(_t, on="project", how="left").sort("cost_usd", descending=True)
    mo.ui.table(_tbl.to_pandas(), label="プロジェクト別サマリ", selection=None)
    return


@app.cell
def _(ev, mo, pl, px):
    _g = (
        ev.group_by(["date", "project"]).agg(pl.col("cost_usd").sum())
        .sort("date")
    )
    _fig = px.area(_g.to_pandas(), x="date", y="cost_usd", color="project",
                   title="プロジェクト別 日次コストの推移")
    mo.ui.plotly(_fig)
    return


@app.cell
def _(mo):
    mo.md("## 🚨 エラー")
    return


@app.cell
def _(mo, pl, px, tc):
    _e = tc.filter(pl.col("is_error"))
    if _e.height:
        _g = _e.group_by("tool_name").agg(pl.len().alias("errors")).sort("errors", descending=True)
        _fig = px.bar(_g.to_pandas(), x="tool_name", y="errors",
                      title="ツール別 エラー件数")
        _out = mo.ui.plotly(_fig)
    else:
        _out = mo.md("✅ フィルタ範囲内でツールエラーはありません。")
    _out
    return


@app.cell
def _(mo, pl, tc):
    _e = tc.filter(pl.col("is_error")).select(
        "date", "project", "tool_name",
        pl.col("input_json").str.slice(0, 160).alias("input"),
        pl.col("tool_use_result").str.slice(0, 200).alias("result"),
    )
    mo.ui.table(_e.to_pandas(), label="エラーになったツール呼び出し（直近の調査用）")
    return


@app.cell
def _(mo):
    mo.md("## 📝 内容（プロンプト分析）")
    return


@app.cell
def _(mo, pr, px):
    if pr.height:
        _fig = px.histogram(pr.to_pandas(), x="char_len", nbins=40,
                            title="プロンプト長の分布（文字数）")
        _out = mo.ui.plotly(_fig)
    else:
        _out = mo.md("プロンプトがありません。")
    _out
    return


@app.cell
def _(mo, pl, pr):
    _top = (
        pr.sort("char_len", descending=True)
        .select(
            "date", "project", "char_len",
            pl.col("text").str.slice(0, 200).alias("prompt"),
        )
        .head(20)
    )
    mo.ui.table(_top.to_pandas(), label="長いプロンプト Top 20（要約・分割の候補）")
    return


@app.cell
def _(mo):
    mo.md(
        """
        ---
        💡 **探索のヒント**: 編集モードでは右上の「+」から SQL/Python セルを追加して、
        `ev`(イベント) / `tc`(ツール呼び出し) / `pr`(プロンプト) を自由に集計できます。
        フィルタは全セルに自動で反映されます。
        """
    )
    return


if __name__ == "__main__":
    app.run()
