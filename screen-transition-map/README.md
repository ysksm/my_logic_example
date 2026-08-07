# screen-transition-map — 画面遷移マップ (MVP)

React SPA の画面遷移を **マインドマップ風の遷移図** として可視化し、
各画面のキャプチャ・文言・画面間の操作方法をまとめて閲覧できるツールです。

- 🧭 **遷移図**: 開始画面を左に、下流の画面が右へ広がるツリー表示 (React Flow + dagre)
- 🖥️ **画面一覧**: キャプチャサムネイル / パス / 呼び出し元・先の件数 / 文言数
- 📝 **文言一覧**: 文言 ID ごとに集約し、どの画面で使われているかを横断表示
- 🔍 **画面詳細**: キャプチャ (クリックで拡大) / 呼び出し元・呼び出し先 / 操作方法 (actionType + data-op) / 画面内の文言

## 設計方針: データ駆動

ビューアは **screen-map JSON** (下記スキーマ) を読み込んで表示するだけの構成です。
JSON の作成方法は問いません — 手書き / 同梱の実験的コレクター / 将来の静的解析など、
生成手段は差し替え可能です (このため collector は独立したパッケージにしています)。

```
screen-transition-map/
├── viewer/       # ビューア本体 (React + Vite, port 5176)
├── sample-app/   # 検証用サンプル SPA (port 5175) — data-* 規約のリファレンス実装
└── collector/    # 【実験的】Playwright によるデータ生成候補その1
```

## 起動方法

### ビューア (サンプルデータ同梱)

```bash
cd viewer
npm install
npm run dev   # http://localhost:5176
```

起動直後はサンプルショップ (4 画面) のデータが表示されます。
「📂 JSON を開く」から任意の screen-map JSON を読み込めます。
(キャプチャ画像は `viewer/public/screenshots/` に置くか、JSON に絶対 URL を書いてください)

### サンプルアプリ

```bash
cd sample-app
npm install
npm run dev   # http://localhost:5175
```

ログイン → ホーム (商品一覧) → 商品詳細 / 設定 の 4 画面。

### コレクター (実験的)

sample-app を起動したまま:

```bash
cd collector
npm install
npm run collect -- http://localhost:5175
# ブラウザの実行ファイルを差し替える場合:
# CHROMIUM_PATH=/path/to/chromium npm run collect -- http://localhost:5175
```

`collector/output/` に `screen-map.json` と `screenshots/*.png` が生成されます。
ビューアへの反映は手動コピーです:

```bash
cp collector/output/screen-map.json viewer/src/sample-data/sample.json
cp collector/output/screenshots/*.png viewer/public/screenshots/
```

> コレクターが機械生成する画面名 (document.title) や説明は手書きで整えることを想定しています
> (同梱の `sample.json` も生成後に name / description を調整したものです)。

## data-* 属性の規約

対象アプリ側に以下の属性を付けておくと、コレクターが操作と文言を収集できます。
(ビューアだけを使う場合、この規約は JSON を書くうえでの語彙として使います)

| 属性 | 対象 | 意味 |
|---|---|---|
| `data-op="<操作ID>"` | 遷移を起こしうる操作可能要素 (button / a / form のボタン) | コレクターはこの要素だけをクリックして遷移を観測する。画面内で一意にする |
| `data-op-label="<表示名>"` | 同上 (任意) | 操作の表示名。省略時は要素の textContent |
| `data-wording="<文言ID>"` | 管理対象の文言要素 | 同じ ID を複数画面で使うと「同一文言」として集約される |

`data-testid` と分けているのは、テスト用途と役割を混ぜないため・操作 / 文言の 2 役を明確にするためです。

## screen-map JSON スキーマ

型定義の単一情報源は [`viewer/src/types.ts`](./viewer/src/types.ts) です。概要:

```jsonc
{
  "version": 1,                     // 必須。未対応 version は読み込みエラー
  "meta": { "title": "...", "generatedAt": "...", "generator": "manual | collector | ..." },
  "screens": [
    { "id": "home", "name": "ホーム", "path": "/", "description": "...",
      "screenshot": "screenshots/home.png" }   // 公開ルート相対 or 絶対 URL
  ],
  "transitions": [
    { "id": "t-1", "from": "login", "to": "home",   // from=呼び出し元 / to=呼び出し先
      "operation": {
        "actionType": "submit",                     // click | submit | navigation | auto | other
        "dataOp": "login-submit",
        "selector": "[data-op=\"login-submit\"]",
        "label": "「ログイン」ボタンで送信" } }
  ],
  "wordings": [
    { "id": "app-title", "text": "サンプルショップ",
      "usages": [ { "screenId": "home", "selector": "[data-wording=\"app-title\"]" } ] }
  ]
}
```

## 制約と今後 (MVP)

- レイアウトは LR ツリー固定。放射状 (radial) レイアウトは将来候補
- キャプチャはビューアの `public/screenshots/` 配置か絶対 URL のみ (アップロード機能なし)
- コレクターは data-op のクリック観測のみ (フォーム入力値が必要な遷移、モーダル内遷移などは未対応)
- 編集機能なし (JSON を直接編集して再読み込み)
- データ作成方法は手探り中: 静的解析 (ルート定義のパース) や実行時トレースなどを今後検討
