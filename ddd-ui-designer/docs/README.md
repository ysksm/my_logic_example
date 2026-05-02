# ddd-ui-designer ドキュメント

DDD ドメインモデルから「動く React アプリ」までを 1 つのパイプラインで扱う
設計支援ツールの設計・運用ドキュメントです。

## このフォルダの位置付け

```
ddd-ui-designer/
├── README.md       … プロジェクト概要 + クイックスタート
├── MANUAL.md       … 利用者向け操作手順（クリック単位）
├── docs/           … 本フォルダ。設計・リファレンス
│   ├── README.md   … この目次
│   ├── architecture.md  … システム設計、IR1/IR2 パイプライン
│   ├── patterns.md      … 画面パターン P1〜P5
│   ├── outputs.md       … ツールの 6 つの出力物
│   ├── views.md         … 右ペインタブ + 設定/表示モード
│   ├── samples.md       … バンドル済みサンプル
│   ├── codegen.md       … React アプリ生成 / dev server 自動起動
│   └── api.md           … HTTP API リファレンス
└── e2e/README.md   … E2E テストとデモ
```

## 目次

| ドキュメント | 主な内容 |
|--------------|----------|
| [architecture.md](./architecture.md) | 全体構造、IR1 (DomainModel) → IR2 (AppSpec) パイプライン、Go パッケージ / React コンポーネントの責務、データフロー図 |
| [patterns.md](./patterns.md) | 5 つの画面パターン (P1〜P5) の選択ルール、フィールドカウント、UI ヒント上書き、生成される Screen / Transition / Component |
| [outputs.md](./outputs.md) | このツールから取り出せる 6 種類の成果物 (AppSpec JSON / モックプレビュー / 画面遷移図 / ER 図 / tar.gz / サーバ起動済みアプリ) |
| [views.md](./views.md) | 右ペインの 3 タブ (🪟 / 🔀 / 📐) と SVG 描画、🛠 設定 / 👁 表示 のモード切替 |
| [samples.md](./samples.md) | embed されたサンプル 3 種 (Shop / Blog / Project) と読込メニュー |
| [codegen.md](./codegen.md) | React + Vite プロジェクト生成、tar.gz ダウンロード、サーバー側 `npm install` & `vite dev` 起動の lifecycle |
| [api.md](./api.md) | HTTP API のエンドポイント完全リファレンス |

## まず読むなら

- **使い方を知りたい** → [`../MANUAL.md`](../MANUAL.md)
- **何が出力されるか知りたい** → [outputs.md](./outputs.md)
- **画面パターンの仕組みを知りたい** → [patterns.md](./patterns.md)
- **API を叩きたい** → [api.md](./api.md)
- **アーキテクチャ全体を理解したい** → [architecture.md](./architecture.md)

## 関連プロジェクト

- `ddd-diagram-generator` (リポジトリ内) — TypeScript コードを解析して
  ドメイン図を生成。本ツールの IR1 を外部から供給する候補。
- `ui-builder` (リポジトリ内) — DataModel-first のローコード UI ビルダー。
  本ツールの AppSpec をランタイムで動かす候補。
