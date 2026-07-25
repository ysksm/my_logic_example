# 画面遷移図デザイナー (screen-flow-designer)

[React Flow](https://reactflow.dev/) を使った画面遷移図の作成・編集ツール。
画面をノード、遷移(クリック・フォーム送信など)をエッジとして GUI で編集でき、
JSON でエクスポート / インポートできる。

将来的な Playwright 連携を前提に設計しており、同梱のクローラーが出力する JSON を
**マージインポート**することで、実際のアプリを自動巡回した結果を図に反映できる。

## 起動方法

```bash
cd screen-flow-designer
npm install
npm run dev   # http://localhost:5174
```

その他のスクリプト:

```bash
npm run build    # 型チェック + プロダクションビルド
npm run lint     # 型チェックのみ
npm run crawl -- <ベースURL> [出力ファイル]   # Playwright クロール (下記参照)
```

## 機能

- **画面の追加・編集**: ツールバーの「画面を追加」でノード作成。選択すると右パネルで
  画面名 / URL / 説明を編集できる
- **遷移の作成・編集**: ノード右端の ○ から遷移先ノードの左端 ○ へドラッグ。
  右パネルでラベル・トリガー種別 (click / submit / navigation / auto / other)・
  CSS セレクタを編集できる
- **自動レイアウト**: dagre による左→右の階層レイアウト
- **エクスポート / インポート**: 後述の JSON フォーマットで保存・読込。
  インポートは「置換」と「マージ」の 2 モード
- **自動保存**: 編集内容は localStorage に自動保存され、リロード後も復元される
- **削除**: 選択して Backspace / Delete、または右パネルの削除ボタン

## JSON フォーマット (ScreenFlowDocument)

エクスポート / インポート / Playwright クローラーの共通フォーマット。
型定義は [`src/types.ts`](src/types.ts) を参照。

```jsonc
{
  "version": 1,
  "screens": [
    {
      "id": "login",
      "name": "ログイン",
      "url": "/login",                  // マージ時のマッチングキー
      "description": "説明 (任意)",
      "position": { "x": 0, "y": 0 },   // 任意。無ければ自動レイアウト
      "discoveredBy": "manual",         // "manual" | "playwright"
      "lastSeenAt": "2026-07-25T00:00:00.000Z"
    }
  ],
  "transitions": [
    {
      "id": "t-login-home",
      "source": "login",
      "target": "home",
      "trigger": {
        "type": "submit",               // click | submit | navigation | auto | other
        "selector": "form#login",       // Playwright で再現可能な CSS セレクタ
        "label": "ログインボタン"
      },
      "discoveredBy": "manual"
    }
  ]
}
```

## Playwright 連携

`playwright/crawl.mjs` が対象サイトを同一オリジン内で BFS クロールし、
上記フォーマットの JSON を生成する。

```bash
# 初回のみブラウザをインストール
npx playwright install chromium

# クロール実行 (デフォルト最大 20 画面、MAX_PAGES で変更可)
npm run crawl -- http://localhost:5173 crawl-result.json
MAX_PAGES=50 npm run crawl -- https://example.com
```

生成された JSON をアプリの **「インポート (マージ)」** で取り込むと:

- 既存の画面と **URL (正規化後のパス) でマッチング**し、手動で調整した
  配置・画面名・説明は保持したまま `lastSeenAt` などの実測情報を更新
- 新しく発見された画面・遷移だけが追加され、新規ノードは自動レイアウトで配置
- Playwright 由来の画面にはノード上に `PW` バッジが表示される

クロール → マージ → 手動整理、を繰り返すことで、実アプリの変化に追従した
画面遷移図をメンテナンスできる。クローラーは SPA のリンク (`a[href]`) ベースの
シンプルな実装なので、ボタン遷移・認証付きページなどは対象アプリに合わせて
`crawl.mjs` を拡張する想定。
