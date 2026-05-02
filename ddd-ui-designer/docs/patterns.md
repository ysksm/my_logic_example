# 画面パターン (P1〜P5)

ddd-ui-designer はドメインの形から **5 つの定番 UI パターン** のいずれかを
規則的に選択します。本ドキュメントはルールと、各パターンが生成する
Screen / Transition の詳細を扱います。

## 5 パターン

| ID | 名称 | 概要 | 主用途 |
|----|------|------|--------|
| **P1** | List + Modal | 一覧画面 + モーダルの新規/詳細 | 小規模で頻繁にCRUDするマスタ |
| **P2** | List + Detail | 一覧 → 詳細画面 → 編集画面 | 中型のレコード、詳細表示が必要 |
| **P3** | Master-Detail | 親+子をひとつの画面で同時編集 | Aggregate 内に子 Entity を持つもの |
| **P4** | Wizard | ステップ式の複数画面登録 | 大規模で初期登録が複雑 |
| **P5** | Single Form | 1 画面の単発フォーム | Singleton (アプリ設定など) |

## 自動選択ルール (決定木)

```
if   uiHint.pattern が指定されている              → そのパターン
elif isSingleton                                 → P5 (Single Form)
elif 子Entity あり and 総フィールド数 > WizardFieldLimit → P4 (Wizard)
elif 子Entity あり                               → P3 (Master-Detail)
elif 総フィールド数 ≤ SmallFormFieldLimit        → P1 (List + Modal)
else                                              → P2 (List + Detail)
```

実装は `server/internal/rules/derive.go:planFor`。

### 閾値

| キー | 既定値 | 意味 |
|------|--------|------|
| `SmallFormFieldLimit` | 5  | このフィールド数**以下**なら P1 (小型フォーム) |
| `WizardFieldLimit`    | 20 | このフィールド数**より多い** + 子Entity ありなら P4 |

トップバー右の `small≤` / `wizard>` 入力で動的変更可能。
API では `POST /api/derive { domain, config: {...} }` で渡す。

### フィールド数の数え方

`rules.totalFieldCount` の挙動:

- プリミティブ型 (`string`/`int`/`bool`/`date`/`enum`/`text`): **+1**
- `ref` (他 Aggregate への参照): **+1**
- `vo` (Value Object) で **Identifier VO** (`isIdentifier:true`): **+1**
- `vo` で 非 Identifier VO: VO 内のフィールド数だけ加算 (展開してカウント)
  - 例: `Money{amount, currency}` を持つフィールド → **+2**

つまり Aggregate Root が見る「実質のフォーム要素数」で判定する。

## 生成される画面

各パターンは `rules.generateForPattern` で実装されている。

### P1: List + Modal

```
┌──────────────────┐  openModal  ┌──────────────────┐
│ scr_X_list       │ ──────────▶ │ scr_X_modal       │
│ (Table + 新規作成 │ ◀────────── │ (フォーム + 保存/  │
│  ボタン)          │  save/close  │  キャンセル)       │
└──────────────────┘              └──────────────────┘
```

| Screen | kind | 役割 |
|--------|------|------|
| `scr_X_list`  | `list`  | テーブル + 新規作成ボタン |
| `scr_X_modal` | `modal` | フォーム (作成/編集兼用) |

| Transition | event |
|------------|-------|
| list → modal  | openModal |
| modal → list  | save |
| modal → list  | close |

### P2: List + Detail

```
┌────────┐  select  ┌────────┐  edit  ┌────────┐
│ list   │ ───────▶ │ detail │ ─────▶ │ edit   │
│        │  create  │        │ ◀──── │        │
│        │ ─────────────────────────▶ │        │
│        │ ◀────────────────────────  │        │
│        │           back/save/cancel │        │
└────────┘                            └────────┘
```

| Screen | kind | 役割 |
|--------|------|------|
| `scr_X_list`   | `list`   | テーブル + 新規作成 |
| `scr_X_detail` | `detail` | 読み取り専用フォーム + 編集/戻るボタン |
| `scr_X_edit`   | `edit`   | 編集フォーム + 保存/キャンセル |

| Transition | event |
|------------|-------|
| list → detail | select |
| list → edit   | create |
| detail → edit | edit |
| detail → list | back |
| edit → detail | save |
| edit → detail | cancel |

### P3: Master-Detail

子 Entity を `tab` (既定) / `section` / `table` のいずれかで親フォームの
中に並べる。`uiHint.childStyle` で切替可能。

```
┌─────────────────────────────┐
│ scr_X_master                  │
│ ┌─────────────────────┐       │
│ │ Section: Root Entity │       │
│ ├─────────────────────┤       │
│ │ Tab: Child1          │       │
│ │ Tab: Child2          │       │
│ ├─────────────────────┤       │
│ │ [保存]               │       │
│ └─────────────────────┘       │
└──────────────┬───────────────┘
               │ save (self-loop)
               ▼
            scr_X_master
```

| Screen | kind |
|--------|------|
| `scr_X_master` | `master` |

| Transition | event |
|------------|-------|
| master → master | save (自己ループ) |

### P4: Wizard

ルートエンティティのフィールドを「基本情報」と各 VO ごとのステップに分割
し、ステップ画面 + レビュー画面を生成する。

```
┌──────────┐ next ┌──────────┐ next        ┌──────────┐ submit
│ step1     │────▶│ step2     │── ... ──────▶│ review    │──┐
│ 基本情報  │◀────│ {VO 名}   │              │           │  │
│           │ back│           │              │           │  │
└──────────┘     └──────────┘              └──────────┘  │
                                                  ▲ back  │
                                                  │       │
                                                  └───────┘
                                                  submit (self-loop)
```

| Screen | kind |
|--------|------|
| `scr_X_step1`, `scr_X_step2`, ... | `wizard-step` |
| `scr_X_review` | `wizard-review` |

| Transition | event |
|------------|-------|
| stepN → step{N+1} | next |
| step{N+1} → stepN | back |
| stepLast → review | next |
| review → stepLast | back |
| review → review   | submit (自己ループ) |

### P5: Single Form

```
┌──────────────────┐
│ scr_X_settings    │
│ (Singleton 用    │
│  単一フォーム)    │
└─────────┬────────┘
          │ save (self-loop)
          ▼
       scr_X_settings
```

| Screen | kind |
|--------|------|
| `scr_X_settings` | `settings` |

| Transition | event |
|------------|-------|
| settings → settings | save (自己ループ) |

## UI ヒントによる上書き

`Aggregate.uiHint` に明示するとルールを上書きできる。

```json
{
  "name": "BulkOrder",
  "uiHint": { "pattern": "P4" },
  ...
}
```

| プロパティ | 値 | 効果 |
|-----------|----|------|
| `pattern` | `P1`〜`P5` | 自動選択を強制上書き (UI ヒントが最優先) |
| `formStyle` | `inline` / `modal` / `dialog` | （予約 — 将来用、現状未使用） |
| `childStyle` | `tab` / `section` / `table` | P3 採用時の子 Entity 表示方法 |

## フィールド型 → コンポーネント

`rules.simpleField` および `rules.fieldComponent` の対応表。

| `Field.type` | `Component.type` | 補足 |
|------------|------------------|------|
| `string` | `TextInput` | |
| `text`   | `TextArea`  | |
| `int`    | `NumberInput` | |
| `bool`   | `Checkbox` | |
| `date`   | `DatePicker` | |
| `enum`   | `RadioGroup` (≤ 4 値) / `Select` | カーディナリティで分岐 |
| `ref`    | `RefPicker` | `props.refTo` に対象 Aggregate 名 |
| `vo` (Identifier) | `Hidden` | UI に出さず ID は内部で管理 |
| `vo` (複合) | `Section` (子コンポーネント展開) | フラット化 (`form.parent_subfield`) |

## ドメインサービス

`Domain.services[]` に書かれた `Service` で `confirm: true` のものは、
親 Aggregate に対して **`scr_<svc>_confirm`** という確認画面を生成する
(`ConfirmDialog` コンポーネント)。

```json
"services": [
  { "name": "PlaceOrder", "aggregateRef": "Order", "confirm": true }
]
```

→ 生成される画面: `svc_Order_PlaceOrder_confirm` (kind: `confirm`)

## ルールのテスト

`server/internal/rules/derive_test.go` に決定木のユニットテストあり:

```bash
cd ddd-ui-designer/server
go test ./internal/rules
```

すべてのパターン分岐 + UI ヒント上書き + VO 展開のフィールドカウントを
検証している。
