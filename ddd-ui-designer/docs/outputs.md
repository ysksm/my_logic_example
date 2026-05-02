# 出力物カタログ

ddd-ui-designer は同じ `DomainModel` から **6 種類**の成果物を派生できます。
用途に応じて取り出し方を選びます。

## 一覧

| # | 出力物 | 形式 | 取得方法 |
|---|--------|------|----------|
| 1 | **AppSpec JSON** | JSON | `POST /api/derive` |
| 2 | **🪟 モックプレビュー** | 画面内 HTML | UI 右ペイン → 🪟 タブ |
| 3 | **🔀 画面遷移図** | 画面内 SVG | UI 右ペイン → 🔀 タブ |
| 4 | **📐 ドメイン ER 図** | 画面内 SVG | UI 右ペイン → 📐 タブ |
| 5 | **React+Vite アプリ tar.gz** | gzipped tar | UI「📦 tar.gz」/ `POST /api/generate` |
| 6 | **起動済み React アプリ** | 動作中の HTTP サーバ | UI「🚀 生成 → 実行」/ `POST /api/launch` |

## 1. AppSpec JSON (IR2)

```bash
curl -X POST http://localhost:8095/api/derive \
  -H "Content-Type: application/json" \
  -d '{"domainId":"shop"}' \
  | jq
```

返却例（抜粋）:
```jsonc
{
  "domainId": "shop",
  "domainName": "Shop Domain",
  "plans": [
    {
      "aggregateRef": "Order",
      "pattern": "P3",
      "reason": "子Entityあり (Master-Detail)",
      "screenIds": ["scr_Order_master"],
      "navLabel": "Order"
    },
    ...
  ],
  "screens": [ {id, kind, title, components, ...}, ... ],
  "transitions": [ {from, to, event}, ... ],
  "navRoots": ["scr_Order_master", "scr_Customer_list", ...]
}
```

**用途**: 仕様書としてリポジトリにコミット、別言語のジェネレータの入力、
他システムとのスペック共有。

詳細スキーマは [api.md](./api.md#post-apiderive) と
`server/internal/ui/spec.go` を参照。

## 2. 🪟 モックプレビュー

派生済みの `AppSpec` を React コンポーネントで描画した「結果イメージ」。
実データは入らないモック (`form.title` 等のプレースホルダ表示) で、
`Aggregate ごとのカード × Screen ごとのモック` として右ペインに並ぶ。

**用途**: パターン採用根拠の確認、デザイン議論。

実装: `ui/src/components/ScreenPreview.tsx`

## 3. 🔀 画面遷移図 (Screen Flow Diagram)

`screens` と `transitions` を **swim lane 形式の SVG フロー図**として描画。

- 1 行 = 1 Aggregate (紫の破線で囲む swim lane)
- 各行に `[P3] 子Entityあり (Master-Detail)` のような採用根拠
- ノード: `kind` ごとに色分け (list=青、detail=緑、edit=オレンジ、master=紫…)
- 矢印:
  - 順方向 (左→右): 黒実線
  - 戻り方向: 灰の破線、上にカーブ
  - 自己ループ: 小さなアーチ
- 各エッジに `event` ラベル (save / select / cancel など)

**用途**: 画面遷移の俯瞰、ステークホルダー説明、設計レビュー。

実装: `ui/src/components/FlowDiagram.tsx` (純 SVG、依存なし)

## 4. 📐 ドメイン ER 図 (Domain ER Diagram)

`DomainModel` (= IR1) を **ER 風に SVG 描画**したもの。AppSpec の派生は
不要 (常時表示)。

- 1 列 = 1 Aggregate (紫の破線クラスタで囲む)
- ヘッダ色:
  - 緑 = Root Entity
  - 青 = 子 Entity (コンポジション)
  - 紫 = 複合 VO (例: `Money{amount, currency}`)
  - 灰 = Identifier VO (UI では非表示扱い)
- フィールド行: `*name : type` (`*` は required)
  - `→ Customer[]`: 他 Aggregate への `ref`
  - `«Money»`: VO 利用
  - `enum(3)`: enum はカーディナリティ
- Aggregate 間の `ref` を灰の点線で結線

**用途**: ドメイン構造の俯瞰、リファクタリング検討、新メンバーへの説明。

実装: `ui/src/components/DomainDiagram.tsx` (純 SVG、依存なし)

## 5. React+Vite アプリ tar.gz

```bash
curl -X POST http://localhost:8095/api/generate \
  -H "Content-Type: application/json" \
  -d '{"domainId":"shop","format":"react"}' \
  -o shop-app.tar.gz
```

または UI「📦 tar.gz」ボタンでブラウザ直ダウンロード。

展開すると以下の構成:
```
shop-app/
├── package.json / vite.config.ts / tsconfig.json / index.html / README.md
└── src/
    ├── main.tsx / styles.css       (静的)
    ├── runtime.tsx / db.ts         (静的: 汎用レンダラー + localStorage)
    ├── App.tsx                     (生成: transitions + ナビ state-machine)
    └── screens/
        ├── index.ts                (生成: 画面レジストリ)
        └── scr_<aggregate>_<kind>.tsx (生成: 1 画面 1 ファイル)
```

```sh
tar xzf shop-app.tar.gz
cd shop-app
npm install && npm run dev
```

**用途**: ローカルでスタンドアローンに動かす、カスタマイズして開発を継続、
配布、CI で生成物の差分を取る。

実装: `server/internal/generate/`、詳細は [codegen.md](./codegen.md)。

## 6. 起動済み React アプリ (🚀 生成 → 実行)

サーバ側で 5 番のアプリを **生成 + `npm install` + `vite dev`** まで自動
実行し、URL を返す。クリックひとつで動くプロトタイプにアクセスできる
最短ルート。

```
[1] ファイル生成   …… <runs-dir>/<id>-app/ に展開
[2] npm install   …… 初回のみ (node_modules があれば skip)
[3] npm run dev   …… 空きポートで Vite dev server を起動
[4] ポート待機     …… 30 秒以内に LISTEN を確認
                  ↓
[5] ready ✅      右下パネルに URL が出現
```

**用途**: その場で触れるプロトタイプ、デモ、デザイン妥当性検証。

詳細は [codegen.md](./codegen.md)。

## それぞれの「鮮度」と更新タイミング

| 出力 | 更新タイミング |
|------|----------------|
| AppSpec JSON | 都度 API 呼び出し |
| モックプレビュー | `▶ 派生` クリック時 |
| 画面遷移図 | 同上 |
| ER 図 | ドメイン編集の都度 (派生不要) |
| tar.gz | 「📦 tar.gz」クリック時 |
| 起動済みアプリ | 「🚀 生成 → 実行」クリック時。再クリックで既存プロセスを停止 → 再生成 → 再起動 (`node_modules` は保持) |

## どれを使うべきか

| 目的 | 推奨出力 |
|------|----------|
| 仕様としてコミット | AppSpec JSON |
| デザインレビュー | 画面遷移図 + ER 図 |
| ステークホルダー説明 | モックプレビュー or 起動済みアプリ |
| 開発の出発点 | tar.gz |
| 「とりあえず動かしたい」 | 起動済みアプリ |
| CI で生成物検証 | tar.gz (展開して `npm run build`) |
