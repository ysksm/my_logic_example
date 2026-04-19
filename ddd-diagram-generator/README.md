# ddd-diagram-generator

TypeScript で書かれた DDD ドメイン層を解析し、ER 図風のインタラクティブな設計図を
生成するツールです。**パスを指定して解析 → 表示パターンを切り替えながら閲覧**する
ワークフローに最適化されています。

```
ddd-diagram-generator/
├── server/   # Go — TypeScript 静的解析 + HTTP API
│   ├── internal/analyzer  # AST 風パーサと DDD 分類器
│   ├── internal/api       # POST /api/analyze
│   └── testdata/sample-domain  # 動作確認用サンプル
└── ui/       # React + TypeScript (Vite)
    └── src
        ├── components     # DiagramCanvas / EntityNode / ControlPanel
        ├── layout         # dagre / grid / クラスタレイアウト
        └── App.tsx        # 全体の state 管理・フォーカスモード
```

## 特徴

- **パス指定で解析** — 絶対パスを渡すだけで `.ts` / `.tsx` を再帰的に走査。
- **DDD ステレオタイプの自動分類** — `extends AggregateRoot` / `implements ValueObject`
  といった基底クラスの有無、`xxxRepository` / `xxxService` / `xxxEvent` といった命名規約、
  `readonly` コンストラクタパラメータなどから `aggregate` / `entity` / `valueObject` /
  `repository` / `service` / `factory` / `event` / `command` / `query` / `policy` / `enum` /
  `interface` / `class` のいずれかに振り分けます。
- **集約の自動推定** — Aggregate Root からフィールド参照をたどり、そこから参照されている
  Entity / ValueObject を同じ集約に属するものとしてタグ付けします。
- **5 種類の表示パターン** — 横向き/縦向きの階層レイアウト、グリッド、集約ごと/モジュール
  ごとのクラスタレイアウトを切替。
- **グループの可視化** — 集約・モジュール・種別で、関係するノードを枠線で囲って可視化。
- **非表示コントロール** — ノード単位 / 種別単位でチェックボックス ON/OFF。
- **フォーカスモード** — あるノードを選ぶと、それと「関係しているものだけをまとめて表示」
  します。深さ (1〜5) を調整して辿る範囲を制御できます。
- **ドラッグで配置を上書き** — 自動レイアウトの結果を手で動かせます。「レイアウト再適用」で
  リセット。

## 起動手順

ターミナルを 2 枚開いて:

```sh
# 1) Go API を :8090 で起動
cd server
go run . -addr :8090

# 2) React UI を :5174 で起動 (/api は :8090 へプロキシ)
cd ui
npm install
npm run dev
```

<http://localhost:5174> を開き、左上の入力欄に解析したい TypeScript ディレクトリの
**絶対パス** を入力して「解析」ボタンを押します。
付属のサンプル (`server/testdata/sample-domain`) を試すと、Order 集約・Customer 集約・
共通型の関係が描画されます。

## API

```
POST /api/analyze
Content-Type: application/json

{
  "path": "/abs/path/to/domain",
  "includeTests": false,
  "excludeDirs": ["migrations"]
}
```

レスポンスは `{ nodes, edges, modules, stats }` を含む JSON グラフです
(`server/internal/analyzer/model.go` の `Graph` 型を参照)。

セキュリティ上の注意: 実運用時は `go run . -roots /abs/path/to/project` のように
走査を許可するルートを明示してください。無指定時は任意パスを解析できます。

## 解析の範囲

- `class` / `abstract class` / `interface` / `enum` / `type` 宣言を抽出します。
- フィールド型 (コンストラクタパラメータプロパティ含む) とメソッドシグネチャから
  ユーザ定義型への参照を辺 (edge) として表現します。
- 以下は **対象外** です: 完全な TypeScript 型推論、ジェネリクスの具体化、
  `import` の解決 (同名のクラスはモジュール近接で解決)、`.d.ts`、テストファイル。

必要に応じて `server/internal/analyzer/parser.go` の `builtinTypes` に「無視する
組み込み型」を追加したり、`classify` の分類ルールを調整したりしてください。

## テスト

```sh
cd server
go test ./...
```

`TestAnalyzeSampleDomain` が分類結果・辺・集約推定を同時に検証します。
