import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell
def _():
    import pandas as pd
    import numpy as np

    # シード値を固定して再現性を確保
    np.random.seed(42)

    # 設定
    cities = ['Tokyo', 'New York', 'London']
    months = pd.date_range(start="2023-01-01", periods=12, freq='ME')

    data = []

    for city in cities:
        # 都市ごとのベース気温と変動幅を設定
        if city == 'Tokyo':
            base_temp = 15
            amp_temp = 10
            base_precip = 50
        elif city == 'New York':
            base_temp = 12
            amp_temp = 15
            base_precip = 80
        else: # London
            base_temp = 10
            amp_temp = 7
            base_precip = 45

        for i, date in enumerate(months):
            # 正弦波を用いて季節変動をシミュレート (1月が最低、7月が最高付近)
            temp = base_temp + amp_temp * np.sin((i - 3) * np.pi / 6) + np.random.normal(0, 1)
            # 降水量はランダムに変動させつつベース値を設定
            precip = base_precip + np.random.normal(0, 20)
            precip = max(0, precip) # 降水量がマイナスにならないように
        
            data.append({
                'Date': date,
                'City': city,
                'AvgTemperature': round(temp, 1),
                'Precipitation': round(precip, 1)
            })

    # DataFrameの作成
    df_weather = pd.DataFrame(data)

    # インデックスをDateに設定
    df_weather = df_weather.set_index('Date')

    df_weather
    return (df_weather,)


@app.cell
def _(df_weather):
    df=df_weather.pivot(columns='City', values='AvgTemperature')
    df
    return (df,)


@app.cell
def _():
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    return go, make_subplots


@app.cell
def _(df, go):
    def _():
        fig = go.Figure()
        for city in df.columns:
            fig.add_trace(go.Scatter(
                x=df.index,
                y=df[city],
                mode='lines+markers',
                name=city,
                line=dict(shape='spline')
            ))

        fig.update_layout(
            title='Monthly Average Temperature by City (2023)',
            xaxis_title='Month',
            yaxis_title='Average Temperature (°C)',
            legend_title='City',
            template='plotly_dark',
            hovermode='x unified'
        )
        return fig


    _()
    return


@app.cell
def _(make_subplots):
    fig=make_subplots(cols=2, rows=2)
    return (fig,)


@app.cell
def _(fig, mo):
    mo.ui.plotly(fig)
    return


@app.cell
def _():
    return


if __name__ == "__main__":
    app.run()
