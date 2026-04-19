# ui-builder

Tooljet 風のローコード UI ビルダー。**データモデル先行 (data-model first)** の設計思想で、スキーマを定義すればサーバーがフルな CRUD アプリ (一覧 / 新規 / 詳細 / 編集の 4 画面 + 状態遷移) をスキャフォールドします。React 製ビルダーで生成後のスクリーンを編集 — コンポーネントをキャンバスにドラッグ、プロパティを編集、遷移を接続し、**▶ Preview** ボタンで同じ Go API を使って実際に動かせます。

```
ui-builder/
├── server/      # Go HTTP API、JSON ファイル永続化、スキャフォールドジェネレーター
└── ui/          # React + TypeScript 製ビルダー + プレビューランタイム
```

## 概念

- **DataModel** — Rails 風のスキーマ (`name`, `fields[]`)。
  フィールド型: `string | text | int | bool | date | ref`。
- **App** — UI メタデータドキュメント。以下を含む:
  - `screens[]` — 各スクリーンは絶対配置の `components` を保持。
  - `transitions[]` — `{from, to, event}` の辺。各スクリーン *は状態そのもの*。
  - `initialScreen` — 開始状態。
  - `stateVariables` — ランタイム変数 (例 `selectedId`)。
- **Component** — `{id, type, props, events}`。`events.onClick` で
  `EventAction` (`navigate | saveRecord | deleteRecord | setVar`) を宣言。
- **Scaffold** — `POST /api/models/{name}/scaffold` で list / new / show / edit の
  4 画面が配線済みの App を生成。

バインディングは単純なトークンで表現され、ランタイムで解決されます (`eval` は一切使いません):

| トークン       | 参照元                                 |
|----------------|----------------------------------------|
| `$state.x`     | ランタイム状態変数 / フォーム値         |
| `$record.x`    | 詳細/編集画面で選択中のレコード         |
| `$row.x`       | イベントを発火したテーブル行            |

フォーム入力は `bind="form.fieldName"` を使って `state.form` に読み書きします。
`saveRecord` アクションが `state.form` を `/api/records/{model}` へ POST します。

## 起動方法

ターミナル 2 つで:

```sh
# 1. Go API を :8080 で起動
cd server
go run . -addr :8080 -data ./data

# 2. React ビルダーを :5173 で起動 (/api は :8080 へプロキシ)
cd ui
npm install
npm run dev
```

http://localhost:5173 を開き、**Models** をクリックして `Post` モデル
(`title:string`, `body:text`, `published:bool`) を追加、**Scaffold app** を押下。
生成された App がビルダーに読み込まれるので、**▶ Preview** で実際に動かせます。

## DDD ドメインビルダー

トップバーの **Domain (DDD)** をクリックするとフルスクリーンの ER 図エディタに入ります。

ドメインドキュメントは 3 種類のノードで構成され、SVG キャンバス上でドラッグ可能なノードとして表示されます:

| 種類              | ヘッダー色   | 役割                                        |
|-------------------|--------------|---------------------------------------------|
| 《Value Object》  | 青           | 不変な複合型および **ID**                   |
| 《Entity》        | 緑           | 同一性を持つ (Identifier VO を参照)         |
| 《Aggregate》     | 紫・破線     | 整合性境界。所属ノードを囲む枠              |

辺:
- **実線矢印** — Entity → Entity の参照 (`one` / `many`)
- **破線** — Entity が Value Object を利用 (identifier または属性)

**→ Generate DataModels** をクリックするとドメインが既存の DataModel コレクションへ
平坦化されます (その後は通常のフローで App スキャフォールドまで繋がります):

- 各 Entity が DataModel になります。
- Identifier VO は内部プリミティブへ畳み込まれます
  (`UserId{value:string}` → `id: string` フィールド)。
- 通常 VO 属性は `attr_subfield` 命名で展開されます
  (`Money{amount,currency}` を持つ `total: Money` →
  `total_amount`, `total_currency`)。
- Entity の参照はターゲット名を指す `ref` フィールドになります。

つまり全体フローは **DDD モデル → DataModel → スキャフォールド App** です。

## API

| Method | Path                                   | 用途                            |
|-------:|----------------------------------------|---------------------------------|
| GET    | `/api/health`                          | 生存確認                        |
| GET    | `/api/models`                          | データモデル一覧                |
| POST   | `/api/models`                          | モデルの upsert                 |
| DELETE | `/api/models/{name}`                   | モデルとレコードを削除          |
| POST   | `/api/models/{name}/scaffold`          | モデルから App を生成           |
| GET    | `/api/apps`                            | App 一覧                        |
| GET    | `/api/apps/{id}`                       | App 取得                        |
| POST   | `/api/apps`                            | App の upsert                   |
| DELETE | `/api/apps/{id}`                       | App 削除                        |
| GET    | `/api/records/{model}`                 | レコード一覧                    |
| POST   | `/api/records/{model}`                 | `{id, values}` の upsert        |
| DELETE | `/api/records/{model}/{id}`            | レコード削除                    |
| GET    | `/api/domains`                         | DDD ドメイン一覧                |
| POST   | `/api/domains`                         | ドメインの upsert               |
| GET    | `/api/domains/{id}`                    | ドメイン取得                    |
| DELETE | `/api/domains/{id}`                    | ドメイン削除                    |
| POST   | `/api/domains/{id}/scaffold`           | ドメイン → DataModel に平坦化   |

永続化は `-data` 以下の JSON ファイル (`models.json`, `apps.json`,
`records.json`, `domains.json`) で完結するため、DB のプロビジョニングは不要です。

## ディレクトリ構成

```
server/
  main.go
  internal/
    storage/      # models / apps / records / domains の JSON ファイル永続化
    api/          # http.ServeMux ルーティング + CORS ミドルウェア
    scaffold/     # DataModel → App、および Domain → DataModel ジェネレーター
ui/
  src/
    types.ts                 # 共通型定義
    api.ts                   # fetch ラッパー
    App.tsx                  # ビルダーのシェル (トップバー + 3 ペイン)
    components/
      Palette.tsx            # 左側コンポーネント一覧
      Canvas.tsx             # ドラッグ/リサイズ可能な設計面
      Properties.tsx         # 右側プロパティ + イベントエディタ
      ScreensPanel.tsx       # 状態機械エディタ
      ModelEditor.tsx        # データモデル CRUD モーダル
      Preview.tsx            # メタデータを解釈するランタイム
      renderComponent.tsx    # キャンバスとプレビューで共有するレンダラー
      DomainBuilder.tsx      # フルスクリーン DDD エディタ
      ERDiagram.tsx          # SVG ER 図 (VO / Entity / Aggregate)
```
