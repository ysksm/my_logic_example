# my_logic_example

実験・学習・試作・実用レベルの小さな自作アプリ／ツールを 1 リポジトリに集めたモノレポです。各サブディレクトリは独立したプロジェクトで、それぞれ別の技術スタック（Go / Python / TypeScript / Babylon.js / marimo など）で書かれています。

このページは全プロジェクトを **一覧で一望できる目次** です。詳細は各ディレクトリの `README.md` を参照してください。

## 目次（一覧）

| プロジェクト | カテゴリ | 主な技術 | 完成度 | POC? |
|---|---|---|---|---|
| [cad-viewer](./cad-viewer) | 3D / CAD | Go + Wails + Babylon.js + three.js | 🟢 実用レベル | — |
| [ddd-ui-designer](./ddd-ui-designer) | コード生成 / DDD | Go + React + Vite | 🟢 実用レベル | — |
| [pcap-go](./pcap-go) | ネットワーク | Go + gopacket + React | 🟢 実用レベル | — |
| [ticket-manager](./ticket-manager) | 業務系 SaaS 風 | Go + Multi-DB + React | 🟢 実用レベル | — |
| [ui-builder](./ui-builder) | ローコード | Go + React + Vite | 🟢 実用レベル | — |
| [webcam-go](./webcam-go) | メディア / ストリーミング | Go + AVFoundation/v4l2 + WebSocket | 🟢 実用レベル | — |
| [ddd-diagram-generator](./ddd-diagram-generator) | DDD 静的解析 | Go + React + Vite | 🟡 動作する試作 | — |
| [jd-go](./jd-go) | Jira 連携 | Go + DuckDB + HTMX/Alpine | 🟡 動作する試作 | — |
| [stock-price-viewer](./stock-price-viewer) | データ ETL | Python + marimo + yfinance | 🟡 動作する試作 | — |
| [babylon-js-learning](./babylon-js-learning) | 3D 学習 | Babylon.js (CDN) + HTML/JS | 🔵 学習用 | ✅ |
| [polling-app](./polling-app) | フロント学習 | React + Redux Toolkit (CRA) | 🔵 学習用 | ✅ |
| [chrome_dev_tool_remote](./chrome_dev_tool_remote) | ブラウザ計測 | Python + marimo + DuckDB | 🟠 POC / 実験 | ✅ |
| [chrome_remote_devtools](./chrome_remote_devtools) | ブラウザ自動化 | Node.js + CDP | 🟠 POC / 実験 | ✅ |
| [exporters](./exporters) | 監視 / メトリクス | Go + Rust + Prometheus + Grafana | 🟠 POC / 実験 | ✅ |
| [jira_db_sync](./jira_db_sync) | Jira 連携 (旧版) | Python + marimo + DuckDB | 🟠 POC / 実験 | ✅ |
| [react-calendar-poc](./react-calendar-poc) | カレンダー UI | React + TypeScript + Vite | 🟠 POC / 実験 | ✅ |
| [youtube_list](./youtube_list) | YouTube 同期 | Python + marimo + DuckDB | 🟠 POC / 実験 | ✅ |
| [docs](./docs) | 横断ドキュメント | Markdown / SVG / Slides | 📄 資料 | — |

完成度の凡例:
- 🟢 **実用レベル** — レイヤード設計・テスト・ビルド成果物・README 完備。実際に動かして使える
- 🟡 **動作する試作** — 動くが、テスト／CI／ドキュメント整備に余地あり
- 🔵 **学習用** — チュートリアル目的。技術習得のためのサンプル
- 🟠 **POC / 実験** — 概念検証。永続的に運用する前提ではない
- 📄 **資料** — コードではなくドキュメント

## プロジェクト解説

### 🟢 実用レベル

#### [cad-viewer](./cad-viewer) — マルチフォーマット CAD ビューア
STL / glTF / OBJ / STEP / IGES / FBX / 3MF / DAE / 3DS / PLY / EDZ など 12 以上のフォーマットに対応した CAD ビューア。Go の単一コードベースから Web サーバ版と Wails デスクトップ版の両方をビルドできる。フロントは Babylon.js + three.js を Loader として併用する 3 ブリッジ設計。STL パーサ単体テストあり、Makefile (`dev` / `build-desktop`) 完備。

#### [ddd-ui-designer](./ddd-ui-designer) — DDD モデルから UI を生成するツール
DDD のドメインモデル (IR1) → UI パターン (IR2) → モックアップ／画面遷移／ER 図／React+Vite アプリ（tar.gz or ライブサーバ）まで生成する教材兼ツール。E2E テスト、アーキテクチャ文書 (`docs/`)、5 種のパターン (P1–P5)、ライブプレビュー、サンプルデータ同梱。

#### [pcap-go](./pcap-go) — リアルタイムパケットキャプチャ
gopacket ベースの packet capture + WebSocket ライブストリーム + Wireshark 風デコーダ + ピア解析（MAC→ベンダー名変換）。React SPA を埋め込み配信。`-tags ffmpeg` で実キャプチャ、無印でシミュレータモード。プロト IDL (`idl/pcap.proto`)、レイヤード設計 (domain/application/infrastructure/presentation)、`ARCHITECTURE.md` あり。

#### [ticket-manager](./ticket-manager) — マルチ DB 対応チケット管理
チケット／カレンダー／工数管理を一体化した社内ツール風アプリ。OpenAPI 3.0 IDL、DuckDB / SQLite / PostgreSQL / MySQL を切り替え可能（ドライバごとのマイグレーション SQL）、`go:embed` でフロントを単一バイナリに同梱。リポジトリ連携（git ブランチ作成）、メンテナンスモード（任意 SQL 実行）も備える。

#### [ui-builder](./ui-builder) — DataModel ファーストのローコード UI ビルダー
Tooljet 風のローコード環境。スキーマ定義 → CRUD アプリ自動生成（list / new / show / edit）→ ドラッグ＆ドロップで視覚的編集 → ライブプレビュー。DDD ドメインエディタ、状態機械エディタ、SVG ベースの ER 図エディタも内蔵。`eval` を使わないトークンバインディング設計。

#### [webcam-go](./webcam-go) — 単一バイナリ Webcam サーバ
macOS AVFoundation / Linux v4l2 を直接叩いて MJPEG + WebSocket でブラウザに配信する Webcam サーバ。`-tags ffmpeg` で実キャプチャ、無印でシミュレータ。スナップショット API、stats ストリーム、SPA 同梱。プロト IDL あり、レイヤード設計 (core/web/idl)。

### 🟡 動作する試作

#### [ddd-diagram-generator](./ddd-diagram-generator) — DDD ドメインモデル静的解析
TypeScript ソースから Aggregate / Entity / Value Object を抽出して、フォーカスモード／レイアウト切替対応のインタラクティブ ER 風ダイアグラムを描画。Go の解析サーバ + React UI 構成。testdata あり、CI なし。

#### [jd-go](./jd-go) — Jira → DuckDB 同期 + ダッシュボード
Jira issue を取得して DuckDB に蓄積し、HTMX + Alpine.js + ECharts のダッシュボードで可視化する Go アプリ。Wails のデスクトップ版もビルド可能、SSE 対応、Tailwind CSS。39 ファイル規模、Makefile 完備。テストとドキュメントは弱め。

#### [stock-price-viewer](./stock-price-viewer) — 株価データ ETL パイプライン
Yahoo Finance から株価を取得し、Plotly でチャート化、CSV / HTML エクスポートまでを行う marimo アプリ。DMBOK / ETL の概念を意識したアーキテクチャ説明あり。単一ノートブック構成のため、モジュール単位のテストは未整備。

### 🔵 学習用

#### [babylon-js-learning](./babylon-js-learning) — Babylon.js 段階学習
Hello World からミニ玉転がしゲームまで、10 ステップで Babylon.js を学ぶ自習プロジェクト。CDN 版なのでビルド不要、HTML を直接開くだけで動く。各ステップに学習ポイントのコメント付き。

#### [polling-app](./polling-app) — Redux Toolkit の練習
投票／アンケートアプリ。CRA + Redux Toolkit + TypeScript の最小構成。実装は最小限で、Redux のキャッチアップ用に近い。

### 🟠 POC / 実験

#### [chrome_dev_tool_remote](./chrome_dev_tool_remote) — リモート Chrome の DevTools ログ収集
SSH トンネル経由で CDP (Chrome DevTools Protocol) ログを収集し、DuckDB に格納して marimo ノートブック上で可視化／クエリする実験環境。`.env` 駆動、テストなし。

#### [chrome_remote_devtools](./chrome_remote_devtools) — CDP/Playwright の素振り
chrome-remote-interface / playwright-core / commander を組み合わせた Node.js 製 CLI のスタブ。README なし、CLI コマンド未実装、依存だけ揃った状態。

#### [exporters](./exporters) — Prometheus エクスポータ PoC
macOS のメトリクス（CPU / メモリ / Swap）を Go と Rust の両方で実装し、Prometheus + Grafana で取得・描画して比較する PoC。mini-Prometheus 自作も含む。`PoC` という単語が直接ディレクトリ構造内に出てくる。

#### [jira_db_sync](./jira_db_sync) — 旧版の Jira 同期
[jd-go](./jd-go) より以前の Python 版。marimo + asyncio + DuckDB。README が空に近く、後継の jd-go に移行済みと思われる。

#### [react-calendar-poc](./react-calendar-poc) — Google Calendar 風 UI
1 日 / 5 日 / 週 / 月の 4 ビュー、イベント CRUD、localStorage 永続化を持つカレンダー UI。`package.json` の description に明示的に "POC" / "prototype" と記載。

#### [youtube_list](./youtube_list) — YouTube メタデータ同期
YouTube Data API でチャンネル／動画情報を取得して DuckDB に保存し、Plotly / Altair で可視化する marimo アプリ。API キー必須、テストなし。

### 📄 資料

#### [docs/](./docs) — 横断ドキュメント
個別プロジェクトに紐づかないドキュメント置き場。AI 統合戦略についての解説 Markdown、インフォグラフィック (SVG)、スライド (HTML / Markdown) を収録。

## 技術スタック別インデックス

- **Go** — cad-viewer / ddd-diagram-generator / ddd-ui-designer / exporters (mac/go-exporter) / jd-go / pcap-go / ticket-manager / ui-builder / webcam-go
- **Python (marimo)** — chrome_dev_tool_remote / jira_db_sync / stock-price-viewer / youtube_list
- **React + Vite + TypeScript** — ddd-diagram-generator (UI) / ddd-ui-designer (UI) / pcap-go (UI) / react-calendar-poc / ticket-manager (UI) / ui-builder (UI)
- **CRA + Redux** — polling-app
- **Babylon.js / three.js** — babylon-js-learning / cad-viewer
- **Wails (デスクトップ)** — cad-viewer / jd-go
- **DuckDB** — chrome_dev_tool_remote / jd-go / jira_db_sync / stock-price-viewer / ticket-manager / youtube_list
- **Rust** — exporters (mac/rust-exporter)
- **Node.js (CDP)** — chrome_remote_devtools

## 用途別インデックス

- **3D / 可視化** — babylon-js-learning, cad-viewer, pcap-go (パケット可視化)
- **DDD / モデリング** — ddd-diagram-generator, ddd-ui-designer, ui-builder
- **業務 / 社内ツール** — jd-go, jira_db_sync, ticket-manager
- **データ収集 / ETL** — chrome_dev_tool_remote, exporters, stock-price-viewer, youtube_list
- **ストリーミング / メディア** — pcap-go, webcam-go
- **フロントエンド学習** — polling-app, react-calendar-poc
