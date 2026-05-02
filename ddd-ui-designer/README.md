# ddd-ui-designer

DDD のドメインモデル (Aggregate / Entity / Value Object / Service) から、
**画面パターンを自動派生する**設計支援ツールです。

`ddd-diagram-generator` (コードからの図生成) と `ui-builder` (DataModel → Scaffold)
を補完するレイヤとして、IR1 (DomainModel) → ルールエンジン → IR2 (AppSpec) の
パイプラインを担います。

> 📘 操作マニュアルは [MANUAL.md](./MANUAL.md)、E2E テストと自動デモは
> [e2e/README.md](./e2e/README.md) を参照してください。

## このツールの「出力」

| 出力物 | 中身 | 取得方法 |
|--------|------|----------|
| **AppSpec (JSON)** | IR2: 採用パターン・Screen・Transition・Component の仕様 | `POST /api/derive` |
| **画面モックプレビュー** | 派生結果を 3ペイン UI で可視化 | UI 右ペイン (`▶ 派生`) |
| **動作可能な React アプリ** | `npm install && npm run dev` ですぐ動く Vite + React + TS プロジェクト一式 | UI の「📦 Reactアプリ生成」ボタン → `<id>-app.tar.gz` をダウンロード / `POST /api/generate` |

生成された tar.gz を展開すると以下の構成になっており、フォーム入力・保存・
一覧表示まで `localStorage` でローカル動作します:

```
<id>-app/
├── package.json / vite.config.ts / tsconfig.json / index.html / README.md
└── src/
    ├── main.tsx / styles.css
    ├── App.tsx              # 遷移定義 + ナビゲーション state-machine
    ├── runtime.tsx          # Component → JSX の汎用レンダラー
    ├── db.ts                # Aggregate 単位の localStorage CRUD
    └── screens/
        ├── index.ts         # 画面レジストリ
        └── <screenId>.tsx   # 1ファイル = 1Screen (IR2 が直書き)
```

```sh
tar xzf shop-app.tar.gz
cd shop-app
npm install
npm run dev    # http://localhost:5173
```

```
ddd-ui-designer/
├── server/
│   ├── go.mod
│   ├── main.go
│   ├── examples/shop.json     # サンプルドメイン
│   └── internal/
│       ├── domain/   # IR1: DomainModel (Aggregate / Entity / VO / Service)
│       ├── ui/       # IR2: AppSpec (Screen / Transition / Component)
│       ├── rules/    # パターン選択 + 画面生成エンジン
│       ├── storage/  # JSON ファイル永続化
│       └── api/      # HTTP ルーティング
└── ui/               # React + Vite ビルダー (3ペイン)
```

## 5つの定番パターン

| ID | 名称 | 自動選択ルール |
|----|------|----------------|
| **P1** | List + Modal      | 子Entityなし & フィールド数 ≤ `SmallFormFieldLimit` (既定 5) |
| **P2** | List + Detail     | 子Entityなし & フィールド数 > `SmallFormFieldLimit` |
| **P3** | Master-Detail     | 子Entityあり |
| **P4** | Wizard            | 子Entityあり & フィールド数 > `WizardFieldLimit` (既定 20) |
| **P5** | Single Form       | `isSingleton: true` |

`uiHint.pattern` を `Aggregate` に書けば自動選択を上書きできます。
VO 内のフィールドは展開後の数で計算されます (`Money{amount,currency}` → 2)。

## 起動

ターミナルを 2 つ:

```sh
# 1) Go API を :8095 で
cd server
go run . -addr :8095 -data ./data

# 2) React UI を :5175 で (/api は :8095 にプロキシ)
cd ui
npm install
npm run dev
```

ブラウザで <http://localhost:5175> を開き、サンプルを試すには:

```sh
# 別ターミナルで
curl -X POST http://localhost:8095/api/domains \
  -H "Content-Type: application/json" \
  -d @server/examples/shop.json
```

UIのトップバーから "Shop Domain" を選んで「▶ 派生」を押すと、4つの集約に対し
`Order=P3 / Customer=P1 / Product=P2 / ShopSettings=P5` が割り当てられた
画面プレビューが右ペインに表示されます。

## API

| Method | Path | 用途 |
|--------|------|------|
| GET    | `/api/health`             | 生存確認 |
| GET    | `/api/rules`              | パターン定義と既定の閾値 |
| GET    | `/api/domains`            | DomainModel 一覧 |
| POST   | `/api/domains`            | DomainModel upsert |
| GET    | `/api/domains/{id}`       | DomainModel 取得 |
| DELETE | `/api/domains/{id}`       | DomainModel 削除 |
| POST   | `/api/derive`             | DomainModel → AppSpec を派生 |
| POST   | `/api/generate`           | DomainModel → React+Vite アプリ tar.gz を生成 |

`/api/derive` は `{domain, config?}` または `{domainId, config?}` を受け取り、
`AggregatePlan[]` (どの集約にどのパターンを採用したかのトレース) と、
それに対応する `Screen[]` / `Transition[]` を含む `AppSpec` を返します。

## 中間表現 (IR)

### IR1 — DomainModel
- `Aggregate { name, isSingleton, root: Entity, entities[], valueObjects[], uiHint }`
- `Entity { name, fields[], children[] }`  ※`children` は同一集約内の子Entity名
- `ValueObject { name, fields[], isIdentifier }`
- `Field { type: string|text|int|bool|date|enum|ref|vo, voTypeRef?, refTo?, enumValues? }`
- `Service { name, aggregateRef, confirm }`

### IR2 — AppSpec
- `Screen { id, kind: list|detail|edit|modal|master|wizard-step|wizard-review|settings, components[] }`
- `Transition { from, to, event }`
- `AggregatePlan { aggregateRef, pattern, reason, screenIds }`

`Component` は `{type, bind, label, props, children[]}` のツリーで、
`TextInput` / `TextArea` / `Select` / `RadioGroup` / `Checkbox` /
`DatePicker` / `NumberInput` / `RefPicker` / `Section` / `Tab` / `Table` /
`EditableTable` / `ReadOnlyForm` / `Summary` / `Button` などを使います。

## ルールのチューニング

`rules.Config` の `SmallFormFieldLimit` / `WizardFieldLimit` を
派生リクエストの `config` で渡せば、プロジェクトごとの基準に変更できます。
UI トップバーの数値入力からも切り替え可能です。

## テスト

```sh
cd server
go test ./...
```

`TestPatternSelection` でルールテーブル、`TestVOFieldFlattenedInCount` で
VO展開のカウント、`TestDerivePopulatesScreens` で IR2 生成を検証します。

## 既存ツールとの連携

- `ddd-diagram-generator` の解析 JSON を `DomainModel` に変換すれば、
  TypeScript コードから直接 IR1 を取り込めます。
- `AppSpec` は `ui-builder` の `App` (screens + transitions) と意図的に近い
  構造にしているため、ランタイムへ転送する変換層を追加すれば、ライブプレビュー
  まで一気通貫で繋げられます。
