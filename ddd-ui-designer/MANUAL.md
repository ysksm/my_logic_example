# ddd-ui-designer 使い方マニュアル

DDDのドメインモデル（Aggregate / Entity / Value Object / Service）から、
画面パターンを自動派生する設計支援ツールの操作マニュアルです。

---

## 目次

1. [このツールでできること](#1-このツールでできること)
2. [起動方法](#2-起動方法)
3. [画面構成](#3-画面構成)
4. [基本ワークフロー](#4-基本ワークフロー)
5. [Aggregate / Entity / VO の編集](#5-aggregate--entity--vo-の編集)
6. [パターン派生と読み方](#6-パターン派生と読み方)
7. [自動選択ルールの詳細](#7-自動選択ルールの詳細)
8. [UI ヒントによる上書き](#8-ui-ヒントによる上書き)
9. [API を直接使う](#9-api-を直接使う)
10. [チートシートとよくある質問](#10-チートシートとよくある質問)

---

## 1. このツールでできること

- **ドメインモデルを GUI またはJSONで編集** — Aggregate / Entity / Value Object / Field を構造化された形で記述。
- **画面パターンの自動選択** — 5 つの定番パターン（P1〜P5）から最適なものを規則的に決定。
- **画面プレビュー** — 派生された画面（フォーム、テーブル、ウィザード等）をその場でモック表示。
- **閾値の動的調整** — 「フォームが小さい/大きい」「ウィザードに切り替える」といった判断基準をプロジェクトに合わせて変更。
- **永続化と再利用** — JSONファイルとして保存・読み込み、他ツール（`ddd-diagram-generator`、`ui-builder`）との連携も視野。

---

## 2. 起動方法

### 前提

- Go 1.21+
- Node.js 18+

### サーバー起動

```sh
cd ddd-ui-designer/server
go run . -addr :8095 -data ./data
```

| オプション | 既定値 | 説明 |
|----|----|----|
| `-addr` | `:8095` | 待ち受けアドレス |
| `-data` | `./data` | DomainModel の保存先ディレクトリ（自動作成） |

### UI 起動

別のターミナルで:

```sh
cd ddd-ui-designer/ui
npm install   # 初回のみ
npm run dev
```

ブラウザで <http://localhost:5175> を開きます（`/api` は自動的に `:8095` へプロキシされます）。

### 動作確認

```sh
curl http://localhost:8095/api/health
# {"status":"ok"}
```

### サンプルの読み込み

```sh
curl -X POST http://localhost:8095/api/domains \
  -H "Content-Type: application/json" \
  -d @ddd-ui-designer/server/examples/shop.json
```

UI のトップバーで「Shop Domain」を選択して読み込めます。

---

## 3. 画面構成

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar: ドメイン選択 / id・name / 保存 / 閾値 / フィルタ / ▶ 派生 │
├────────────┬────────────────────────────┬────────────────────┤
│ 左ペイン   │ 中央ペイン                 │ 右ペイン           │
│ Aggregate  │ Aggregate Editor           │ UI 派生プレビュー  │
│ ツリー     │ - 名前 / Singleton         │ - パターン根拠     │
│            │ - UIヒント                 │ - 画面モック       │
│ + 追加     │ - Root Entity              │ - 遷移リスト       │
│ × 削除     │ - 子Entity                 │                    │
│            │ - Value Objects            │                    │
└────────────┴────────────────────────────┴────────────────────┘
```

### 左ペイン (Aggregate ツリー)

- 集約一覧。`◆` は通常集約、`⚙` は Singleton。
- 行クリックで中央ペインに編集対象として読み込まれます。
- `+ 追加` で新規 Aggregate、行右の `×` で削除。

### 中央ペイン (Aggregate Editor)

選択中の Aggregate を編集します。詳細は [§5](#5-aggregate--entity--vo-の編集) 参照。

### 右ペイン (UI 派生プレビュー)

`▶ 派生` を押すと表示されます。各 Aggregate に対し:
- 採用されたパターン（P1〜P5）
- 採用理由（フィールド数・子Entity有無など）
- 各 Screen のモックビュー
- Screen 間の遷移

トップバーの「選択中のみ」を ON にすると、左で選んだ Aggregate のみを表示します。

---

## 4. 基本ワークフロー

### 4.1 新規ドメインを 0 から作る

1. 左上のドロップダウンを `(新規)` にする。
2. id 欄と name 欄を編集（例: `id=blog`, `name=Blog Domain`）。
3. 左ペインで `+ 追加` → 新規 Aggregate を作成（既定で `name` フィールドを持つRootが入る）。
4. 中央ペインでフィールド・子Entity・VOを追加。
5. `▶ 派生` で右ペインに画面が表示される。
6. `保存` を押すとサーバーに永続化される。

### 4.2 既存ドメインを編集

1. トップバーのドロップダウンから対象を選択。
2. 中央ペインで編集。
3. `▶ 派生` で結果を再生成。
4. `保存` で上書き。

### 4.3 派生結果を比較する

- フィールド数を変えて `▶ 派生` を再実行 → どこで P1 → P2 → P4 に切り替わるか確認。
- 子 Entity を追加すると即 P3、フィールド数が `WizardFieldLimit` を超えると P4。

---

## 5. Aggregate / Entity / VO の編集

### 5.1 Aggregate の基本属性

| 項目 | 役割 |
|----|----|
| 名前 | ナビゲーション・URLルートの単位 |
| Singleton | チェックすると P5（単一フォーム）に固定 |
| UIヒント Pattern | `(自動)` 以外を選ぶとパターン自動選択を上書き |
| 子エンティティ表示 | P3 採用時のレイアウト（tab / section / table） |

### 5.2 Root Entity

- すべての Aggregate には Root Entity が必ず1つあります。
- `名前` は Aggregate と一致させる必要はありませんが、合わせると把握しやすくなります。
- `子Entity (children)` セレクタで、同じ Aggregate 内の子 Entity を関連付けます。

### 5.3 Field の追加

「+ field」を押すと行が増えます。各列の意味:

| 列 | 内容 |
|----|----|
| name | フィールド名（フォーム上のラベルにもなる） |
| type | `string` `text` `int` `bool` `date` `enum` `ref` `vo` |
| 3列目 | `vo` のときVO選択 / `ref`のときRef先 / `enum`のときカンマ区切り値 |
| × | 削除 |

#### type 別の生成 UI

| type | UI |
|----|----|
| `string` | TextInput |
| `text` | TextArea |
| `int` | NumberInput |
| `bool` | Checkbox |
| `date` | DatePicker |
| `enum` | 値が4個以下→RadioGroup、それ以上→Select |
| `ref` | RefPicker（refTo の Aggregate を検索選択） |
| `vo` | VO の中身を Section として展開（Identifier VO は Hidden） |

### 5.4 子 Entity

Aggregate Editor の `+ 子Entity追加` で子を追加し、Root Entity の `children` に追加すると P3 の対象になります。

### 5.5 Value Object

`+ VO追加` で追加。`Identifier?` をチェックすると ID用VO となり、画面では非表示扱いに畳み込まれます（`UserId{value:string}` → `id: string`）。

非Identifier VO（例: `Money{amount, currency}`）は、利用側 Entity のフォームで Section として展開され、フィールド数カウントには展開後のサイズが使われます。

---

## 6. パターン派生と読み方

派生プレビューには各 Aggregate ごとにカードが並びます:

```
┌──────────────────────────────────────────┐
│ [P3] Order                                │ ← パターンID と Aggregate名
│ 子Entityあり (Master-Detail)              │ ← 採用理由
│                                            │
│ ┌──────────────────────┐                  │
│ │ Order  [master]      │ ← 生成された画面 │
│ │ ┌────────────────┐   │                  │
│ │ │ Order section  │   │                  │
│ │ │ ▶ tab: Line    │   │ ← 子Entityはタブ │
│ │ │ [保存]         │   │                  │
│ │ └────────────────┘   │                  │
│ └──────────────────────┘                  │
│                                            │
│ transitions: scr_..._master→scr_..._master │
│              [save]                        │
└──────────────────────────────────────────┘
```

### 採用理由の読み方

| メッセージ例 | 意味 |
|----|----|
| `isSingleton=true` | Singleton として P5 採用 |
| `子なし かつ フィールド数 3 ≤ 5` | 小型フォームとして P1 採用 |
| `子なし かつ フィールド数 7` | 中型フォームとして P2 採用 |
| `子Entityあり (Master-Detail)` | P3 採用 |
| `子Entityあり かつ 総フィールド数 25 > 20` | 大型・親子のため P4 採用 |
| `uiHint.pattern で明示指定` | UIヒント上書き |

### 閾値の調整

トップバー右側で動的に切り替え:
- `small≤` = `SmallFormFieldLimit`（既定 5）
- `wizard>` = `WizardFieldLimit`（既定 20）

変更後 `▶ 派生` を押し直してください。

---

## 7. 自動選択ルールの詳細

```
if   uiHint.pattern が指定                  → そのパターン
elif isSingleton                            → P5 (Single Form)
elif 子Entity あり and 総フィールド数 > WizardFieldLimit → P4 (Wizard)
elif 子Entity あり                          → P3 (Master-Detail)
elif 総フィールド数 ≤ SmallFormFieldLimit   → P1 (List + Modal)
else                                         → P2 (List + Detail)
```

### 「総フィールド数」の数え方

- プリミティブ型は1フィールド
- Identifier VO は1フィールド（`UserId{value}` → 1）
- 非 Identifier VO は内部フィールド数で展開
  - `Money{amount, currency}` を1つ持つ → 2 を加算
- `ref` フィールドは1フィールド

---

## 8. UI ヒントによる上書き

`Aggregate.uiHint` 経由で自動判定を上書きできます。

| プロパティ | 値 | 効果 |
|----|----|----|
| `pattern` | `P1`〜`P5` | 自動選択を上書き |
| `childStyle` | `tab` / `section` / `table` | P3 のとき子Entityの表示方法 |

**例**: フィールド数が多くても、ナビゲーション上は単純な一覧+モーダルにしたいケース → `uiHint.pattern = "P1"`。

---

## 9. API を直接使う

### 派生だけ実行（保存せず）

```sh
curl -s -X POST http://localhost:8095/api/derive \
  -H "Content-Type: application/json" \
  -d '{"domain": {
    "id":"x","name":"X",
    "aggregates":[{
      "name":"Tag",
      "root":{"name":"Tag","isRoot":true,"fields":[
        {"name":"name","type":"string"},
        {"name":"color","type":"string"}
      ]}
    }]
  }}' | python3 -m json.tool
```

### ルールセット確認

```sh
curl -s http://localhost:8095/api/rules | python3 -m json.tool
```

### 永続化

```sh
# 保存
curl -X POST http://localhost:8095/api/domains \
  -H "Content-Type: application/json" \
  -d @ddd-ui-designer/server/examples/shop.json

# 一覧
curl http://localhost:8095/api/domains

# 取得
curl http://localhost:8095/api/domains/shop

# 削除
curl -X DELETE http://localhost:8095/api/domains/shop
```

派生時に閾値を渡す例:

```sh
curl -X POST http://localhost:8095/api/derive \
  -d '{"domainId":"shop","config":{"SmallFormFieldLimit":3,"WizardFieldLimit":15}}'
```

---

## 10. チートシートとよくある質問

### キーポイント

- **Singleton は最強**: 何があっても P5 になる。
- **子Entity の有無 ≫ フィールド数**: 子があれば P3 か P4、なければ P1 か P2。
- **VO は展開されてカウントされる**: 一見少なくても展開後で計算されている。
- **保存しなくても派生はできる**: 試行錯誤フェーズは保存不要。

### Q&A

**Q. パターンが直感に合わない**
A. 閾値を変えるか `uiHint.pattern` で個別に上書きしてください。プロジェクトの慣習に合わせる場合は閾値の方が一貫します。

**Q. 子Entityが多くて P3 でも画面が重そう**
A. フィールド数を増やすと P4（ウィザード）に切り替わります。`WizardFieldLimit` を下げる手もあります。

**Q. P3 で子Entityをタブではなくテーブルで見たい**
A. UIヒントの「子エンティティ表示」を `table` に変更してください。

**Q. 保存先を変えたい**
A. サーバー起動時の `-data` オプションでパスを指定してください（例: `-data /var/lib/ddd-ui-designer`）。

**Q. ドメインモデルを TypeScript コードから生成したい**
A. 既存ツール `ddd-diagram-generator` の解析結果（Graph JSON）を `DomainModel` に変換するアダプタを書けば一貫したパイプラインになります（README参照）。

**Q. 生成された Screen をそのまま動かしたい**
A. `AppSpec` は `ui-builder` の `App` (screens + transitions) と意図的に近い構造です。コンポーネントタイプ名のマッピングを足せば `ui-builder` のランタイムで動かせます。

---

## 補足: テストとデモ

`ddd-ui-designer/e2e/` にPlaywright によるE2Eテストおよびデモシナリオを同梱しています。
セットアップと使い方は `e2e/README.md` を参照してください。
