# Stock Price Viewer

複数銘柄の株価・取引量・前日比差分/乖離率を可視化し、CSV/HTML形式でエクスポートできる marimo アプリケーション。

## 機能一覧

| 機能 | 説明 |
|------|------|
| 複数銘柄取得 | カンマ区切りで複数の銘柄コードを同時に指定可能（例: `7203.T, 6758.T, AAPL`） |
| 株価チャート | 終値の折れ線グラフと取引量の棒グラフを銘柄ごとに色分け表示 |
| 前日比分析 | 差分金額・乖離率（%）を棒グラフで可視化 |
| サマリー表示 | 各銘柄の直近終値・前日比・期間高値/安値を一覧表示 |
| データテーブル | 銘柄ごとにタブ切り替えで日別データを閲覧 |
| CSVダウンロード | 銘柄ごとのCSVファイルをブラウザからダウンロード |
| HTMLダウンロード | チャート単体 / 統合レポートHTMLをブラウザからダウンロード |
| ファイル保存 | ボタン1クリックで全データ（CSV + HTML）をローカルに一括保存 |

## セットアップ

```bash
# uv を使う場合（推奨）
uv run marimo edit app.py

# pip を使う場合
pip install marimo yfinance plotly pandas
marimo edit app.py
```

## 使い方

1. ブラウザが開いたら「銘柄コード」にカンマ区切りで銘柄を入力
2. 「期間」を選択（1ヶ月〜5年）
3. チャート・サマリー・テーブルが自動更新される
4. CSV/HTMLダウンロードボタン、またはファイル保存ボタンでエクスポート

---

## アーキテクチャ — ETL/DMBOK の文脈から

本アプリケーションのデータフローは、DMBOK（Data Management Body of Knowledge）が定義するデータ統合・相互運用性（Data Integration & Interoperability）の枠組みと、ETL（Extract-Transform-Load）パターンに対応づけて理解できる。

### データフロー全体像

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Data Sources (外部)                          │
│                     Yahoo Finance API (yfinance)                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   E : Extract       │  Cell: データ取得
                    │                     │
                    │  - 複数銘柄を並列取得 │
                    │  - 企業名メタデータ   │
                    │  - OHLCV 時系列取得   │
                    └──────────┬──────────┘
                               │ Raw DataFrame（銘柄ごと）
                    ┌──────────▼──────────┐
                    │   T : Transform     │  Cell: データ取得（同一セル内）
                    │                     │
                    │  - タイムゾーン正規化 │
                    │  - 前日終値の導出     │
                    │  - 差分金額の計算     │
                    │  - 乖離率(%)の計算    │
                    │  - 欠損値の除去       │
                    └──────────┬──────────┘
                               │ Enriched DataFrame（all_data）
          ┌────────────────────┼────────────────────┐
          │                    │                    │
 ┌────────▼────────┐  ┌───────▼────────┐  ┌───────▼────────┐
 │  L1: Serve      │  │  L2: Export    │  │  L3: Persist   │
 │  (表示/配信)     │  │  (ダウンロード) │  │  (ファイル保存) │
 │                 │  │                │  │                │
 │ - Plotlyチャート │  │ - CSV生成      │  │ - CSV書き出し   │
 │ - サマリー表    │  │ - HTML生成     │  │ - HTML書き出し  │
 │ - データテーブル │  │ - 統合レポート  │  │ - 統合レポート  │
 └─────────────────┘  └────────────────┘  └────────────────┘
```

### DMBOK 知識領域との対応

| DMBOK 知識領域 | 本アプリでの実現 |
|---|---|
| **データ統合・相互運用性** (DII) | Yahoo Finance API → pandas DataFrame への抽出・変換パイプライン。外部データソースから構造化データを取り込み、内部モデルに統一する |
| **データ品質管理** (DQM) | `mo.stop()` による空データの検出とユーザーへのフィードバック。欠損値（`dropna`）の除去。エラー銘柄のスキップとエラー理由の表示 |
| **データウェアハウジング/BI** (DW/BI) | 導出指標（前日比差分・乖離率）の算出はDWにおけるファクトテーブル設計に相当。Plotlyチャートによるセルフサービス BI の提供 |
| **ドキュメント & コンテンツ管理** (DCM) | HTML統合レポートの生成。チャート+サマリー+メタデータを単一HTMLに集約し、ポータブルなドキュメントとして配布可能にする |
| **メタデータ管理** (MDM) | 企業名（longName/shortName）をAPIから取得し、チャートやファイル名に反映。銘柄コードと表示名の紐付けを管理 |
| **データストレージ & オペレーション** (DSO) | CSV/HTMLのファイルシステムへの永続化。タイムスタンプ付きファイル名によるバージョニング |

### ETL パイプラインとしての設計

本アプリは marimo のリアクティブセルグラフを活用し、ETL パイプラインをノートブック上に構成している。

```
Extract（抽出）
  データソース: Yahoo Finance API
  方式:        yfinance ライブラリによる REST API 呼び出し
  粒度:        銘柄単位 × 期間指定（1mo〜5y）
  品質ゲート:   空データ検出 → mo.stop() でパイプラインを停止

Transform（変換）
  正規化:       タイムゾーン除去（tz_localize(None)）
  導出カラム:    PrevClose, DiffPrice, DiffPercent
  クレンジング:  shift() による初日欠損の除去（dropna）
  集約:         all_data 辞書に銘柄ごとの DataFrame + メタデータを格納

Load（格納/配信）
  L1 Serve:    marimo UI コンポーネントへのレンダリング（インタラクティブ配信）
  L2 Export:   mo.download() によるオンデマンドダウンロード（CSV / HTML）
  L3 Persist:  ファイルシステムへの一括書き出し（タイムスタンプ付き永続化）
```

### marimo セルグラフと依存関係

marimo のリアクティブ実行モデルにより、各セルは宣言的な DAG（有向非巡回グラフ）を構成する。UI パラメータの変更がセルグラフ上流から下流へ自動伝播し、ETL パイプラインが再実行される。

```
[UI入力] ticker_input, period_select, save_dir_input
    │
    ▼
[Extract + Transform] → all_data
    │
    ├──▶ [Chart: 株価]      → fig_price
    │        │
    ├──▶ [Chart: 差分]      → fig_diff
    │        │
    ├──▶ [Summary: サマリー]
    │
    ├──▶ [Table: データ一覧]
    │
    ├──▶ [CSV Download]
    │
    ├──▶ [HTML Download]  ← fig_price, fig_diff に依存
    │
    └──▶ [File Save]      ← fig_price, fig_diff, save_dir_input に依存
```

入力パラメータ（銘柄コード・期間）を変更するだけで、Extract から Load まで全ステージが自動で再実行される。これは従来の ETL ジョブスケジューラにおける「トリガー駆動実行」に相当し、marimo のセルグラフがオーケストレーション層の役割を担っている。

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| ランタイム / オーケストレーション | [marimo](https://marimo.io/) |
| データ取得 | [yfinance](https://github.com/ranaroussi/yfinance) |
| データ操作 | [pandas](https://pandas.pydata.org/) |
| 可視化 | [Plotly](https://plotly.com/python/) |
| パッケージ管理 | [uv](https://docs.astral.sh/uv/) |

## ディレクトリ構成

```
stock-price-viewer/
├── app.py            # marimo アプリケーション本体
├── pyproject.toml    # プロジェクト定義・依存関係
├── uv.lock           # 依存関係ロックファイル
├── README.md         # 本ドキュメント
└── output/           # ファイル保存先（実行時に自動生成）
    ├── {ticker}_{timestamp}.csv
    ├── price_chart_{timestamp}.html
    ├── diff_chart_{timestamp}.html
    └── stock_report_{timestamp}.html
```

## ライセンス

MIT
