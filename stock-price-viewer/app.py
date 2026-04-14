import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell
def _(mo):
    mo.md("""
    # 株価・取引量ビューア

    銘柄コードをカンマ区切りで入力して、株価チャート・取引量・前日比の差分金額と乖離率を可視化します。
    """)
    return


@app.cell
def _(mo):
    ticker_input = mo.ui.text(
        value="7203.T, 6758.T",
        label="銘柄コード（カンマ区切りで複数指定可。例: 7203.T, AAPL, GOOGL）",
    )
    period_select = mo.ui.dropdown(
        options={"1ヶ月": "1mo", "3ヶ月": "3mo", "6ヶ月": "6mo", "1年": "1y", "2年": "2y", "5年": "5y"},
        value="6ヶ月",
        label="期間",
    )
    save_dir_input = mo.ui.text(
        value="./output",
        label="保存先ディレクトリ",
    )
    mo.hstack([ticker_input, period_select, save_dir_input], justify="start", gap=1)
    return period_select, save_dir_input, ticker_input


@app.cell
def _(mo, period_select, ticker_input):
    import yfinance as yf
    import pandas as pd

    mo.stop(not ticker_input.value)

    tickers_raw = [t.strip() for t in ticker_input.value.split(",") if t.strip()]

    all_data = {}
    errors = []

    for _ticker_code in tickers_raw:
        try:
            _ticker_obj = yf.Ticker(_ticker_code)
            _df = _ticker_obj.history(period=period_select.value)

            if _df.empty:
                errors.append(f"⚠️ **{_ticker_code}** のデータが見つかりませんでした。")
                continue

            try:
                _info = _ticker_obj.info
                _company_name = _info.get("longName") or _info.get("shortName") or _ticker_code
            except Exception:
                _company_name = _ticker_code

            _df = _df.reset_index()
            _df["Date"] = pd.to_datetime(_df["Date"]).dt.tz_localize(None)
            _df["PrevClose"] = _df["Close"].shift(1)
            _df["DiffPrice"] = _df["Close"] - _df["PrevClose"]
            _df["DiffPercent"] = (_df["DiffPrice"] / _df["PrevClose"]) * 100
            _df = _df.dropna(subset=["PrevClose"])

            all_data[_ticker_code] = {
                "df": _df,
                "company_name": _company_name,
            }
        except Exception as e:
            errors.append(f"⚠️ **{_ticker_code}**: {e}")

    mo.stop(
        not all_data,
        mo.md("\n\n".join(errors) if errors else "⚠️ データを取得できませんでした。"),
    )

    summary_lines = [f"- **{v['company_name']}**（{k}）: {len(v['df'])} 日分" for k, v in all_data.items()]
    if errors:
        summary_lines.extend(["", "#### エラー"] + errors)

    mo.md("### データ取得完了\n\n" + "\n".join(summary_lines))
    return all_data, errors, pd, yf


@app.cell
def _(all_data, mo):
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    fig_price = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.03,
        row_heights=[0.7, 0.3],
        subplot_titles=("株価（終値）", "取引量"),
    )

    _colors_list = [
        "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
        "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
    ]

    for _i, (_ticker_code, _data) in enumerate(all_data.items()):
        _df = _data["df"]
        _name = _data["company_name"]
        _color = _colors_list[_i % len(_colors_list)]

        fig_price.add_trace(
            go.Scatter(
                x=_df["Date"],
                y=_df["Close"],
                mode="lines",
                name=f"{_name} 終値",
                line=dict(color=_color, width=2),
                hovertemplate=f"{_name}<br>日付: %{{x|%Y-%m-%d}}<br>終値: %{{y:,.0f}}<extra></extra>",
            ),
            row=1,
            col=1,
        )

        fig_price.add_trace(
            go.Bar(
                x=_df["Date"],
                y=_df["Volume"],
                name=f"{_name} 取引量",
                marker_color=_color,
                opacity=0.6,
                hovertemplate=f"{_name}<br>日付: %{{x|%Y-%m-%d}}<br>取引量: %{{y:,.0f}}<extra></extra>",
            ),
            row=2,
            col=1,
        )

    fig_price.update_layout(
        title="株価・取引量チャート",
        height=600,
        showlegend=True,
        xaxis2_rangeslider_visible=False,
        hovermode="x unified",
    )
    fig_price.update_yaxes(title_text="株価", row=1, col=1)
    fig_price.update_yaxes(title_text="取引量", row=2, col=1)

    mo.ui.plotly(fig_price)
    return fig_price, go, make_subplots


@app.cell
def _(all_data, go, make_subplots, mo):
    fig_diff = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.08,
        subplot_titles=("前日比 差分金額", "前日比 乖離率（%）"),
    )

    _colors_list = [
        "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
        "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
    ]

    for _i, (_ticker_code, _data) in enumerate(all_data.items()):
        _df = _data["df"]
        _name = _data["company_name"]
        _color = _colors_list[_i % len(_colors_list)]

        fig_diff.add_trace(
            go.Bar(
                x=_df["Date"],
                y=_df["DiffPrice"],
                name=f"{_name} 差分",
                marker_color=_color,
                opacity=0.7,
                hovertemplate=f"{_name}<br>日付: %{{x|%Y-%m-%d}}<br>差分: %{{y:,.0f}}<extra></extra>",
            ),
            row=1,
            col=1,
        )

        fig_diff.add_trace(
            go.Bar(
                x=_df["Date"],
                y=_df["DiffPercent"],
                name=f"{_name} 乖離率",
                marker_color=_color,
                opacity=0.7,
                hovertemplate=f"{_name}<br>日付: %{{x|%Y-%m-%d}}<br>乖離率: %{{y:.2f}}%<extra></extra>",
            ),
            row=2,
            col=1,
        )

    fig_diff.add_hline(y=0, line_dash="dash", line_color="gray", row=1, col=1)
    fig_diff.add_hline(y=0, line_dash="dash", line_color="gray", row=2, col=1)

    fig_diff.update_layout(
        title="前日比 差分・乖離率",
        height=500,
        showlegend=True,
        hovermode="x unified",
    )
    fig_diff.update_yaxes(title_text="差分金額", row=1, col=1)
    fig_diff.update_yaxes(title_text="乖離率 (%)", row=2, col=1)

    mo.ui.plotly(fig_diff)
    return fig_diff,


@app.cell
def _(all_data, mo):
    _sections = []
    for _ticker_code, _data in all_data.items():
        _df = _data["df"]
        _name = _data["company_name"]
        _latest = _df.iloc[-1]

        def _fmt_sign(val, fmt="{:+,.0f}"):
            return fmt.format(val)

        _sections.append(f"""
#### {_name}（{_ticker_code}）

| 項目 | 値 |
|------|-----|
| **日付** | {_latest['Date'].strftime('%Y-%m-%d')} |
| **終値** | {_latest['Close']:,.0f} |
| **前日終値** | {_latest['PrevClose']:,.0f} |
| **前日比 差分** | {_fmt_sign(_latest['DiffPrice'])} |
| **前日比 乖離率** | {_fmt_sign(_latest['DiffPercent'], '{:+.2f}')}% |
| **取引量** | {_latest['Volume']:,.0f} |
| **期間高値** | {_df['Close'].max():,.0f} |
| **期間安値** | {_df['Close'].min():,.0f} |
""")

    mo.md("### 直近データサマリー\n" + "\n".join(_sections))
    return


@app.cell
def _(all_data, mo):
    _tabs = {}
    for _ticker_code, _data in all_data.items():
        _df = _data["df"]
        _name = _data["company_name"]

        _display_df = _df[["Date", "Close", "Volume", "DiffPrice", "DiffPercent"]].copy()
        _display_df.columns = ["日付", "終値", "取引量", "前日比差分", "前日比乖離率(%)"]
        _display_df["日付"] = _display_df["日付"].dt.strftime("%Y-%m-%d")
        _display_df["終値"] = _display_df["終値"].map("{:,.0f}".format)
        _display_df["取引量"] = _display_df["取引量"].map("{:,.0f}".format)
        _display_df["前日比差分"] = _display_df["前日比差分"].map("{:+,.0f}".format)
        _display_df["前日比乖離率(%)"] = _display_df["前日比乖離率(%)"].map("{:+.2f}%".format)
        _display_df = _display_df.iloc[::-1].reset_index(drop=True)

        _tabs[f"{_name}（{_ticker_code}）"] = mo.ui.table(
            _display_df, page_size=15, label=f"{_name} 日別データ一覧（新しい順）"
        )

    mo.ui.tabs(_tabs)
    return


@app.cell
def _(all_data, mo):
    _downloads = []
    for _ticker_code, _data in all_data.items():
        _df = _data["df"]
        _name = _data["company_name"]

        _csv_df = _df[["Date", "Open", "High", "Low", "Close", "Volume", "PrevClose", "DiffPrice", "DiffPercent"]].copy()
        _csv_df.columns = [
            "日付", "始値", "高値", "安値", "終値", "取引量",
            "前日終値", "前日比差分", "前日比乖離率(%)",
        ]
        _csv_df["日付"] = _csv_df["日付"].dt.strftime("%Y-%m-%d")

        _csv_bytes = _csv_df.to_csv(index=False).encode("utf-8-sig")
        _safe_ticker = _ticker_code.replace(".", "_")
        _filename = f"{_safe_ticker}_{_name}_stock_data.csv"

        _downloads.append(
            mo.download(
                data=_csv_bytes,
                filename=_filename,
                mimetype="text/csv",
                label=f"📥 CSV: {_name}（{len(_csv_df)}件）",
            )
        )

    mo.vstack([mo.md("### CSVダウンロード"), mo.hstack(_downloads, gap=1)])
    return


@app.cell
def _(all_data, fig_diff, fig_price, mo):
    _html_downloads = []

    # 株価チャートHTML
    _price_html = fig_price.to_html(include_plotlyjs=True, full_html=True)
    _html_downloads.append(
        mo.download(
            data=_price_html.encode("utf-8"),
            filename="stock_price_chart.html",
            mimetype="text/html",
            label="📊 株価チャート HTML",
        )
    )

    # 差分チャートHTML
    _diff_html = fig_diff.to_html(include_plotlyjs=True, full_html=True)
    _html_downloads.append(
        mo.download(
            data=_diff_html.encode("utf-8"),
            filename="stock_diff_chart.html",
            mimetype="text/html",
            label="📊 差分チャート HTML",
        )
    )

    # 全銘柄統合HTMLレポート
    _report_sections = []
    for _ticker_code, _data in all_data.items():
        _df = _data["df"]
        _name = _data["company_name"]
        _latest = _df.iloc[-1]
        _report_sections.append(f"""
        <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
            <h3>{_name}（{_ticker_code}）</h3>
            <table style="border-collapse: collapse; width: 100%;">
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>日付</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['Date'].strftime('%Y-%m-%d')}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>終値</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['Close']:,.0f}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>前日比差分</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['DiffPrice']:+,.0f}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>前日比乖離率</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['DiffPercent']:+.2f}%</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>取引量</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['Volume']:,.0f}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>期間高値</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_df['Close'].max():,.0f}</td></tr>
                <tr><td style="padding: 4px 8px;"><b>期間安値</b></td><td style="padding: 4px 8px;">{_df['Close'].min():,.0f}</td></tr>
            </table>
        </div>
        """)

    _full_report = f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <title>株価レポート</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }}
        h1 {{ color: #333; }}
        h2 {{ color: #555; margin-top: 40px; }}
    </style>
</head>
<body>
    <h1>株価レポート</h1>
    <h2>サマリー</h2>
    {''.join(_report_sections)}
    <h2>株価・取引量チャート</h2>
    {fig_price.to_html(include_plotlyjs=True, full_html=False)}
    <h2>前日比 差分・乖離率</h2>
    {fig_diff.to_html(include_plotlyjs=False, full_html=False)}
</body>
</html>"""

    _html_downloads.append(
        mo.download(
            data=_full_report.encode("utf-8"),
            filename="stock_report.html",
            mimetype="text/html",
            label="📄 統合レポート HTML",
        )
    )

    mo.vstack([mo.md("### HTMLダウンロード"), mo.hstack(_html_downloads, gap=1)])
    return


@app.cell
def _(all_data, fig_diff, fig_price, mo, save_dir_input):
    import os
    from datetime import datetime

    save_btn = mo.ui.run_button(label="💾 ファイルを保存")
    mo.md(f"### ファイル保存\n\n保存先: `{save_dir_input.value}`\n\n{save_btn}")
    return datetime, os, save_btn


@app.cell
def _(all_data, datetime, fig_diff, fig_price, mo, os, save_btn, save_dir_input):
    mo.stop(not save_btn.value)

    _save_dir = save_dir_input.value
    os.makedirs(_save_dir, exist_ok=True)
    _timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    _saved_files = []

    # CSVファイル保存
    for _ticker_code, _data in all_data.items():
        _df = _data["df"]
        _name = _data["company_name"]
        _safe_ticker = _ticker_code.replace(".", "_")

        _csv_df = _df[["Date", "Open", "High", "Low", "Close", "Volume", "PrevClose", "DiffPrice", "DiffPercent"]].copy()
        _csv_df.columns = [
            "日付", "始値", "高値", "安値", "終値", "取引量",
            "前日終値", "前日比差分", "前日比乖離率(%)",
        ]
        _csv_df["日付"] = _csv_df["日付"].dt.strftime("%Y-%m-%d")

        _csv_path = os.path.join(_save_dir, f"{_safe_ticker}_{_timestamp}.csv")
        _csv_df.to_csv(_csv_path, index=False, encoding="utf-8-sig")
        _saved_files.append(_csv_path)

    # チャートHTML保存
    _price_path = os.path.join(_save_dir, f"price_chart_{_timestamp}.html")
    fig_price.write_html(_price_path, include_plotlyjs=True)
    _saved_files.append(_price_path)

    _diff_path = os.path.join(_save_dir, f"diff_chart_{_timestamp}.html")
    fig_diff.write_html(_diff_path, include_plotlyjs=True)
    _saved_files.append(_diff_path)

    # 統合レポートHTML保存
    _report_sections = []
    for _ticker_code, _data in all_data.items():
        _df = _data["df"]
        _name = _data["company_name"]
        _latest = _df.iloc[-1]
        _report_sections.append(f"""
        <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
            <h3>{_name}（{_ticker_code}）</h3>
            <table style="border-collapse: collapse; width: 100%;">
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>日付</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['Date'].strftime('%Y-%m-%d')}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>終値</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['Close']:,.0f}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>前日比差分</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['DiffPrice']:+,.0f}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>前日比乖離率</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['DiffPercent']:+.2f}%</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>取引量</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_latest['Volume']:,.0f}</td></tr>
                <tr><td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><b>期間高値</b></td><td style="padding: 4px 8px; border-bottom: 1px solid #eee;">{_df['Close'].max():,.0f}</td></tr>
                <tr><td style="padding: 4px 8px;"><b>期間安値</b></td><td style="padding: 4px 8px;">{_df['Close'].min():,.0f}</td></tr>
            </table>
        </div>
        """)

    _full_report = f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <title>株価レポート - {_timestamp}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }}
        h1 {{ color: #333; }}
        h2 {{ color: #555; margin-top: 40px; }}
    </style>
</head>
<body>
    <h1>株価レポート</h1>
    <p>生成日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
    <h2>サマリー</h2>
    {''.join(_report_sections)}
    <h2>株価・取引量チャート</h2>
    {fig_price.to_html(include_plotlyjs=True, full_html=False)}
    <h2>前日比 差分・乖離率</h2>
    {fig_diff.to_html(include_plotlyjs=False, full_html=False)}
</body>
</html>"""

    _report_path = os.path.join(_save_dir, f"stock_report_{_timestamp}.html")
    with open(_report_path, "w", encoding="utf-8") as f:
        f.write(_full_report)
    _saved_files.append(_report_path)

    _file_list = "\n".join([f"- `{f}`" for f in _saved_files])
    mo.md(f"### ✅ 保存完了\n\n以下のファイルを保存しました:\n\n{_file_list}")
    return


if __name__ == "__main__":
    app.run()
