# ddd-ui-designer 使い方マニュアル

DDDのドメインモデル（Aggregate / Entity / Value Object / Service）から、
画面パターンを自動派生する設計支援ツールの操作マニュアルです。

> 📂 本ドキュメントは「**操作手順**」に特化しています。設計・リファレンスは
> [`docs/`](./docs/) を参照してください
> ([architecture](./docs/architecture.md) /
> [patterns](./docs/patterns.md) /
> [outputs](./docs/outputs.md) /
> [views](./docs/views.md) /
> [samples](./docs/samples.md) /
> [codegen](./docs/codegen.md) /
> [api](./docs/api.md))。

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
- **動作可能な React アプリの自動生成** — 「📦 Reactアプリ生成」ボタン1つで Vite + React + TypeScript の tar.gz を生成、`npm install && npm run dev` で即動く。

### このツールが生み出す4つの成果物

| # | 成果物 | 用途 |
|---|--------|------|
| 1 | **AppSpec JSON** (`POST /api/derive`) | 仕様書としてリポジトリにコミット、他システムへの入力 |
| 2 | **モックプレビュー** (UI 右ペイン) | デザイン検討、ステークホルダーへの説明 |
| 3 | **React+Vite アプリ tar.gz** (📦ボタン) | 配布、ローカルクローンして開発を継続 |
| 4 | **🚀 サーバー側で起動済みの React アプリ** (🚀ボタン) | **その場で動かして触れる** — 1クリックで `npm install` + `vite dev` まで完了 |

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
| `-runs` | `./runs` | 「🚀 生成 → 実行」で展開・起動するアプリのルートディレクトリ |

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
  -d @ddd-ui-designer/server/samples/shop.json
```

UI のトップバーで「Shop Domain」を選択して読み込めます。

---

## 2.5 表示モードの切替（🛠 設定 / 👁 表示）

トップバー左の段切替で 2 つのレイアウトを切り替えられます。選んだモードは
ブラウザの localStorage に保存され、次回起動時にも維持されます。

| モード | レイアウト | 用途 |
|--------|------------|------|
| **🛠 設定** | 左ツリー (320px) + 中央エディタ (1fr) + 右ペイン (380px) | ドメインを編集する通常モード |
| **👁 表示** | 左ツリー (220px) + 右ペイン (1fr) ※エディタは畳まれる | プレビュー / 画面遷移図 / ER 図を最大化して見せる、プレゼン・ドキュメント用 |

- 表示モードでも左ツリーは残るので、Aggregate を切替えながら **「選択中のみ」**
  フィルタとの組合せで個別の集約だけにフォーカスできます。
- 表示モードは派生・生成・実行などの「結果」操作と相性が良いため、
  右ペインのタブ (🪟 / 🔀 / 📐) と組合せて使います。

---

## 3. 画面構成

```
┌─────────────────────────────────────────────────────────────────────┐
│ Topbar: 🛠/👁 / 既存ドメイン / 📂 サンプル / id・name / 保存 / 閾値    │
│         / 選択中のみ / ▶ 派生 / 📦 tar.gz / 🚀 生成 → 実行            │
├────────────┬────────────────────────────┬───────────────────────────┤
│ 左ペイン   │ 中央ペイン                 │ 右ペイン (3 タブ)         │
│ Aggregate  │ Aggregate Editor           │ 🪟 モックプレビュー       │
│ ツリー     │ - 名前 / Singleton         │ 🔀 画面遷移図             │
│            │ - UIヒント                 │ 📐 ドメイン ER 図         │
│ + 追加     │ - Root Entity              │                           │
│ × 削除     │ - 子Entity / VO            │                           │
└────────────┴────────────────────────────┴───────────────────────────┘
       ↑ 👁 表示モードでは中央ペインが折り畳まれて右ペインが最大化
```

### 左ペイン (Aggregate ツリー)

- 集約一覧。`◆` は通常集約、`⚙` は Singleton。
- 行クリックで中央ペインに編集対象として読み込まれます。
- `+ 追加` で新規 Aggregate、行右の `×` で削除。

### 中央ペイン (Aggregate Editor)

選択中の Aggregate を編集します。詳細は [§5](#5-aggregate--entity--vo-の編集) 参照。

### 右ペイン (3 つのビュー)

タブで 3 つの可視化を切り替えられます。

| タブ | 内容 | 必要なもの |
|------|------|-----------|
| 🪟 **モックプレビュー** | 派生結果を画面ごとにモックUIで描画 | `▶ 派生` 実行後 |
| 🔀 **画面遷移図** | Screen をノード、Transition を矢印にした SVG フロー図 | `▶ 派生` 実行後 |
| 📐 **ドメイン ER 図** | Aggregate / Entity / VO を ER 図風に描画 | （常時表示） |

#### 🔀 画面遷移図の見方

- 1 行 = 1 Aggregate（紫の破線で囲まれた "swim lane"）
- ノード上部の色帯は Screen kind（list=青、detail=緑、edit=オレンジ、master=紫など）
- ノード内: Title + screen ID
- 矢印: 黒実線 = 順方向の遷移、灰破線（上にカーブ）= 戻り遷移、自己ループ = save 等の自己遷移
- 各ノードに event ラベル（save/select/cancel など）を表記

#### 📐 ドメイン ER 図の見方

- 1 列 = 1 Aggregate（紫の破線で囲まれたクラスタ）
- 緑のヘッダ = **Root Entity**
- 青のヘッダ = **子 Entity**（コンポジション）
- 紫のヘッダ = **複合 VO**（Money など）
- 灰のヘッダ = **Identifier VO**（ID 用、UI では非表示扱い）
- 行内: `フィールド名 : 型` を monospace で表示
  - `*` プレフィックスは required
  - `→ Customer[]` は他 Aggregate への参照
  - `«Money»` は VO 利用
- Aggregate 間の `ref` は灰色の点線で結ばれる

トップバーの「選択中のみ」は **モックプレビュー** にのみ作用します（フロー / ER 図は全 Aggregate 常時表示）。

---

## 4. 基本ワークフロー

### 4.0 サンプルから始める（最短）

**「📂 サンプル ▾」**ボタンに、すぐ試せる 3 種類のドメインがバンドルされています。

| サンプル | 集約 | 実演されるパターン |
|---------|------|-------------------|
| **Blog Domain** | Post / Author / Comment / BlogSettings | P1 + P2 + P5 |
| **Project Management** | Project / Task / User / AppSettings | P1 + P3 + P4 + P5 |
| **Shop Domain** | Order / Customer / Product / ShopSettings | P1 + P2 + P3 + P5 |

操作:
1. トップバーの **📂 サンプル** をクリック
2. メニューから読み込みたいサンプルを選択
3. **「編集に読込」** … 編集ペインに反映 (永続化なし、必要なら手動で保存)
4. **「読込 + 保存」** … 編集に反映 + サーバーへ即保存

その後 `▶ 派生` を押すと 4 つのパターンすべてのプレビューが見られます。
特に **Project Management** は P4 ウィザードを既定の閾値で発動するので、
ウィザードパターンを実際に確かめる用途に便利です。

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

## 8.4 🚀 生成 → 実行（最も手早い動作確認）

「フォルダに展開してすぐに動かす」一発操作です。サーバー側で次の処理が
順次走ります:

```
1. ファイル生成   …… <runs-dir>/<id>-app/ に展開
2. npm install    …… 初回のみ (node_modules があれば skip)
3. npm run dev    …… 空きポートで Vite dev server を起動
4. ポート待機      …… 30秒以内に起動を確認
```

完了するとパネル右下に状態 + URL が表示され、「↗ 新しいタブで開く」を
クリックすると派生済みアプリが動作する状態で開きます。

### 操作

1. ドメインに **id** を必ず設定（パネルから launch には id が必要）。
2. トップバー右の **🚀 生成 → 実行**（緑ボタン）をクリック。
3. 右下のパネルが「ファイル生成中 → installing → starting → 起動完了 ✅」と進む。
4. URL リンクをクリック → 派生したアプリが新しいタブで開く。
5. 不要になったら **◼ 停止** で dev server を停止（フォルダは残る）。

### ステータスの意味

| 表示 | 意味 |
|------|------|
| ファイル生成中… | tsx/json などソースファイルを書き出し中 |
| installing | `npm install` 実行中 (初回のみ、約30〜60秒) |
| starting | Vite dev server プロセスを起動中 |
| 起動完了 ✅ | URL でアクセス可能 |
| 停止しました | プロセスは終了（フォルダ・依存はそのまま） |
| エラー | `.install.log` または `.dev.log` を参照 |

### 同じドメインを再生成すると

- 既存の dev server が**自動的に停止**される
- ソースファイルは**上書き**される
- `node_modules` と `package-lock.json` は**保存される**（高速化）
- 新しい dev server が**再起動**される

### CLI から

```sh
curl -X POST http://localhost:8095/api/launch \
  -H "Content-Type: application/json" \
  -d '{"domainId":"shop"}' | jq
# 状態確認
curl http://localhost:8095/api/runs/shop | jq
# 停止
curl -X POST http://localhost:8095/api/runs/shop/stop | jq
```

`install:false, start:false` を渡すと「ファイルを書くだけ」も可能。
これは CI などで生成物だけ欲しい場合に使います。

### 注意点

- **ddd-ui-designer プロセスを止めると dev server も止まります**（Linux は Pdeathsig、それ以外は終了時の StopAll で kill）。
- 同時に何個でも launch できます（Aggregate id が違えば）。
- 生成フォルダは `<runs-dir>/<id>-app/` で `git rm -rf` してOK。
- **再現性のためにエラーログを確認**: `<runs-dir>/<id>-app/.install.log` および `.dev.log` に実出力が残ります。

---

## 8.5 React アプリの生成（tar.gz でダウンロード）

派生結果を「実際に動くプロトタイプ」として手元に持ち帰れます。

### 手順

1. ドメインを編集して `▶ 派生` で結果を確認。
2. トップバーの **📦 Reactアプリ生成** をクリック。
3. ブラウザが `<domain-id>-app.tar.gz` をダウンロード。
4. 解凍 → 起動:

```sh
tar xzf shop-app.tar.gz
cd shop-app
npm install
npm run dev    # http://localhost:5173
```

### 生成されるアプリの機能

- **Aggregate ナビ** — トップバーに各 Aggregate のボタン
- **画面遷移** — 派生した `transitions` を state-machine として実装
- **フォーム入力 → 保存** — `localStorage` に永続化
- **一覧表示** — 保存済みレコードがテーブルに表示
- **詳細・編集・モーダル** — 採用パターン (P1〜P5) に応じて生成
- **ウィザード (P4)** — 戻る/次へ/登録ボタンが配線済み

### 含まれるファイル

```
<id>-app/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── README.md
└── src/
    ├── main.tsx           # エントリポイント (静的)
    ├── styles.css         # 既定スタイル (静的)
    ├── App.tsx            # 遷移定義 + ナビゲーション (生成)
    ├── runtime.tsx        # Component → JSX レンダラー (静的)
    ├── db.ts              # localStorage CRUD (静的)
    └── screens/
        ├── index.ts       # screen レジストリ (生成)
        └── scr_*.tsx      # 1画面1ファイル、IR2を埋め込み (生成)
```

> ⚠️ 同じドメインで再生成するとファイルは上書きされます。手書きの拡張は
> `src/screens/` 直下ではなく別のディレクトリ（例: `src/custom/`）に置いてください。

### CLI で生成する

```sh
curl -X POST http://localhost:8095/api/generate \
  -H "Content-Type: application/json" \
  -d '{"domainId":"shop","format":"react"}' \
  -o shop-app.tar.gz
```

レスポンスヘッダ `X-App-Root` で展開後のルートディレクトリ名が分かります。

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
  -d @ddd-ui-designer/server/samples/shop.json

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
