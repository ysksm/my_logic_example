import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell
def _(mo):
    mo.md(
        """
        # 株価・取引量ビューア

        銘柄コードを入力して、株価チャート・取引量・前日比の差分金額と乖離率を可視化します。
        """
    )
    return


@app.cell
def _(mo):
    ticker_input = mo.ui.text(
        value="7203.T",
        label="銘柄コード（例: 7203.T, AAPL, GOOGL）",
    )
    period_select = mo.ui.dropdown(
        options={"1ヶ月": "1mo", "3ヶ月": "3mo", "6ヶ月": "6mo", "1年": "1y", "2年": "2y", "5年": "5y"},
        value="6ヶ月",
        label="期間",
    )
    mo.hstack([ticker_input, period_select], justify="start", gap=1)
    return period_select, ticker_input


@app.cell
def _(mo, period_select, ticker_input):
    import yfinance as yf
    import pandas as pd

    mo.stop(not ticker_input.value)

    ticker = yf.Ticker(ticker_input.value)
    df = ticker.history(period=period_select.value)

    mo.stop(
        df.empty,
        mo.md(f"⚠️ **{ticker_input.value}** のデータが見つかりませんでした。銘柄コードを確認してください。"),
    )

    try:
        info = ticker.info
        company_name = info.get("longName") or info.get("shortName") or ticker_input.value
    except Exception:
        company_name = ticker_input.value

    df = df.reset_index()
    df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)

    df["PrevClose"] = df["Close"].shift(1)
    df["DiffPrice"] = df["Close"] - df["PrevClose"]
    df["DiffPercent"] = (df["DiffPrice"] / df["PrevClose"]) * 100

    df = df.dropna(subset=["PrevClose"])

    mo.md(f"### {company_name}（{ticker_input.value}）のデータ取得完了: {len(df)} 日分")
    return company_name, df, info, pd, ticker, yf


@app.cell
def _(df, company_name, mo, ticker_input):
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

    fig_price.add_trace(
        go.Scatter(
            x=df["Date"],
            y=df["Close"],
            mode="lines",
            name="終値",
            line=dict(color="#1f77b4", width=2),
            hovertemplate="日付: %{x|%Y-%m-%d}<br>終値: %{y:,.0f}<extra></extra>",
        ),
        row=1,
        col=1,
    )

    colors_vol = [
        "#e74c3c" if row["Close"] < row["PrevClose"] else "#2ecc71"
        for _, row in df.iterrows()
    ]
    fig_price.add_trace(
        go.Bar(
            x=df["Date"],
            y=df["Volume"],
            name="取引量",
            marker_color=colors_vol,
            hovertemplate="日付: %{x|%Y-%m-%d}<br>取引量: %{y:,.0f}<extra></extra>",
        ),
        row=2,
        col=1,
    )

    fig_price.update_layout(
        title=f"{company_name}（{ticker_input.value}）株価・取引量チャート",
        height=600,
        showlegend=False,
        xaxis2_rangeslider_visible=False,
        hovermode="x unified",
    )
    fig_price.update_yaxes(title_text="株価", row=1, col=1)
    fig_price.update_yaxes(title_text="取引量", row=2, col=1)

    mo.ui.plotly(fig_price)
    return fig_price, go, make_subplots


@app.cell
def _(df, company_name, go, make_subplots, mo, ticker_input):
    fig_diff = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.08,
        subplot_titles=("前日比 差分金額", "前日比 乖離率（%）"),
    )

    colors_diff = ["#e74c3c" if v < 0 else "#2ecc71" for v in df["DiffPrice"]]

    fig_diff.add_trace(
        go.Bar(
            x=df["Date"],
            y=df["DiffPrice"],
            name="差分金額",
            marker_color=colors_diff,
            hovertemplate="日付: %{x|%Y-%m-%d}<br>差分: %{y:,.0f}<extra></extra>",
        ),
        row=1,
        col=1,
    )

    colors_pct = ["#e74c3c" if v < 0 else "#2ecc71" for v in df["DiffPercent"]]

    fig_diff.add_trace(
        go.Bar(
            x=df["Date"],
            y=df["DiffPercent"],
            name="乖離率",
            marker_color=colors_pct,
            hovertemplate="日付: %{x|%Y-%m-%d}<br>乖離率: %{y:.2f}%<extra></extra>",
        ),
        row=2,
        col=1,
    )

    fig_diff.add_hline(y=0, line_dash="dash", line_color="gray", row=1, col=1)
    fig_diff.add_hline(y=0, line_dash="dash", line_color="gray", row=2, col=1)

    fig_diff.update_layout(
        title=f"{company_name}（{ticker_input.value}）前日比 差分・乖離率",
        height=500,
        showlegend=False,
        hovermode="x unified",
    )
    fig_diff.update_yaxes(title_text="差分金額", row=1, col=1)
    fig_diff.update_yaxes(title_text="乖離率 (%)", row=2, col=1)

    mo.ui.plotly(fig_diff)
    return (fig_diff,)


@app.cell
def _(df, mo):
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) >= 2 else None

    def _fmt_sign(val, fmt="{:+,.0f}"):
        return fmt.format(val)

    stats_md = f"""
### 直近データサマリー

| 項目 | 値 |
|------|-----|
| **日付** | {latest['Date'].strftime('%Y-%m-%d')} |
| **終値** | {latest['Close']:,.0f} |
| **前日終値** | {latest['PrevClose']:,.0f} |
| **前日比 差分** | {_fmt_sign(latest['DiffPrice'])} |
| **前日比 乖離率** | {_fmt_sign(latest['DiffPercent'], '{:+.2f}')}% |
| **取引量** | {latest['Volume']:,.0f} |
| **期間高値** | {df['Close'].max():,.0f} |
| **期間安値** | {df['Close'].min():,.0f} |
"""

    mo.md(stats_md)
    return latest, prev, stats_md


@app.cell
def _(df, mo):
    display_df = df[["Date", "Close", "Volume", "DiffPrice", "DiffPercent"]].copy()
    display_df.columns = ["日付", "終値", "取引量", "前日比差分", "前日比乖離率(%)"]
    display_df["日付"] = display_df["日付"].dt.strftime("%Y-%m-%d")
    display_df["終値"] = display_df["終値"].map("{:,.0f}".format)
    display_df["取引量"] = display_df["取引量"].map("{:,.0f}".format)
    display_df["前日比差分"] = display_df["前日比差分"].map("{:+,.0f}".format)
    display_df["前日比乖離率(%)"] = display_df["前日比乖離率(%)"].map("{:+.2f}%".format)

    display_df = display_df.iloc[::-1].reset_index(drop=True)

    mo.ui.table(display_df, page_size=15, label="日別データ一覧（新しい順）")
    return (display_df,)


@app.cell
def _(company_name, df, mo, ticker_input):
    csv_df = df[["Date", "Open", "High", "Low", "Close", "Volume", "PrevClose", "DiffPrice", "DiffPercent"]].copy()
    csv_df.columns = [
        "日付", "始値", "高値", "安値", "終値", "取引量",
        "前日終値", "前日比差分", "前日比乖離率(%)",
    ]
    csv_df["日付"] = csv_df["日付"].dt.strftime("%Y-%m-%d")

    csv_bytes = csv_df.to_csv(index=False).encode("utf-8-sig")

    safe_ticker = ticker_input.value.replace(".", "_")
    filename = f"{safe_ticker}_{company_name}_stock_data.csv"

    download_btn = mo.download(
        data=csv_bytes,
        filename=filename,
        mimetype="text/csv",
        label=f"CSVダウンロード（{len(csv_df)}件）",
    )

    mo.md(f"### データダウンロード\n\n{download_btn}")
    return csv_bytes, csv_df, download_btn, filename, safe_ticker


if __name__ == "__main__":
    app.run()
