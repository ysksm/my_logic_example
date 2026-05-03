# ddd-ui-designer

DDD のドメインモデル (Aggregate / Entity / Value Object / Service) から、
**画面パターンを自動導出し、動く React アプリまで生成する**設計支援ツール。

```
ドメインを書く → ▶ 画面を導出 → モック / 遷移図 / ER 図 → 🚀 動かす
                                                       ↑
                                            tar.gz か、サーバ側で
                                            npm install & vite dev
                                            まで自動実行
```

## ドキュメント

| 入口 | 用途 |
|------|------|
| 📘 [`MANUAL.md`](./MANUAL.md) | 利用者向け操作手順 (クリック単位) |
| 📂 [`docs/`](./docs/) | 設計・リファレンス (アーキ / パターン / API / コード生成 …) |
| 🧪 [`e2e/README.md`](./e2e/README.md) | E2E テスト + 自動デモ |

`docs/` には以下が揃っています:

- [architecture.md](./docs/architecture.md) — IR1 / IR2 パイプライン、パッケージ構成
- [patterns.md](./docs/patterns.md) — 画面パターン P1〜P5 の詳細
- [outputs.md](./docs/outputs.md) — ツールの 6 種類の出力物
- [views.md](./docs/views.md) — 右ペインの 3 タブ + 設定/表示モード
- [samples.md](./docs/samples.md) — バンドル済みサンプル
- [codegen.md](./docs/codegen.md) — React アプリ生成 + dev server 起動の細部
- [api.md](./docs/api.md) — HTTP API 完全リファレンス

## 5 つの画面パターン

ドメインの形から 5 種のうちのいずれかを規則的に選択 (詳細は
[patterns.md](./docs/patterns.md)):

| ID | 名称 | 適用条件 |
|----|------|----------|
| **P1** | List + Modal      | 子Entityなし & フィールド数 ≤ `SmallFormFieldLimit` (既定 5) |
| **P2** | List + Detail     | 子Entityなし & フィールド数 > `SmallFormFieldLimit` |
| **P3** | Master-Detail     | 子Entityあり |
| **P4** | Wizard            | 子Entityあり & フィールド数 > `WizardFieldLimit` (既定 20) |
| **P5** | Single Form       | `isSingleton: true` |

`uiHint.pattern` で個別上書き可。VO は展開後の数でカウント (例:
`Money{amount, currency}` → 2)。

## このツールの「出力」

詳細は [outputs.md](./docs/outputs.md):

| # | 出力物 | 取得方法 |
|---|--------|----------|
| 1 | **AppSpec (JSON)** | `POST /api/derive` |
| 2 | **🪟 モックプレビュー** | UI 右ペイン → 🪟 タブ |
| 3 | **🔀 画面遷移図** | UI 右ペイン → 🔀 タブ |
| 4 | **📐 ドメイン ER 図** | UI 右ペイン → 📐 タブ |
| 5 | **React+Vite アプリ tar.gz** | UI「📦 tar.gz」/ `POST /api/generate` |
| 6 | **🚀 起動済み React アプリ** | UI「🚀 生成 → 実行」/ `POST /api/launch` |

## 起動

```sh
# 1) Go API を :8095 で
cd server
go run . -addr :8095 -data ./data -runs ./runs

# 2) React UI を :5175 で (/api は :8095 にプロキシ)
cd ui
npm install
npm run dev
```

<http://localhost:5175> を開き、トップバーの **📂 サンプル** から
**Blog / Project / Shop** のいずれかを 1 クリックでロード。
**Project Management** を選ぶと P1/P3/P4/P5 が一度に確認できます。

## 表示モード切替

トップバー左の **🛠 設定 / 👁 表示** で、編集向き 3 ペインと
プレゼン向き 2 ペインを切替えられます (詳細は [views.md](./docs/views.md))。
選択は `localStorage` に保存されるので次回も維持。

## 関連ツール

| ツール | 役割 |
|--------|------|
| `ddd-diagram-generator` | TypeScript コードから IR1 を生成 (本ツールの上流候補) |
| `ui-builder` | DataModel-first のローコード UI ビルダー (本ツールの下流候補) |

## ライセンス / コントリビュート

リポジトリ全体のライセンスに従います。新しいパターンや出力フォーマット
の追加方法は [architecture.md#拡張ポイント](./docs/architecture.md#拡張ポイント)
を参照。
