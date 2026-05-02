# ddd-ui-designer / e2e

Playwright で書かれた E2E テストおよび自動デモシナリオです。
`webServer` 設定により、テスト時に Go API（`:8095`）と Vite UI（`:5175`）が
自動的に起動・停止します。データは `e2e/.tmp/data` に隔離されます。

```
e2e/
├── playwright.config.ts
├── scripts/start-api.sh      # Go API を一時データディレクトリで起動
├── tests/
│   ├── helpers.ts            # Designer ページオブジェクト
│   ├── smoke.spec.ts         # アプリ起動 + 既定派生
│   ├── domain-edit.spec.ts   # Aggregate / Field 編集
│   └── pattern-derive.spec.ts# パターン選択ルール
├── demo/
│   └── demo.spec.ts          # ナレーション付き自動デモ (動画 + 連番スクリーンショット)
└── fixtures/                 # サンプルドメインJSON
```

## 初回セットアップ

```sh
cd ddd-ui-designer/e2e
npm install
npm run install:browsers   # = playwright install chromium
```

Linux サーバーで Chromium が依存ライブラリ不足で起動しない場合:

```sh
sudo npx playwright install-deps chromium
```

## テスト実行

```sh
# すべて (CI向け、ヘッドレス)
npm test

# ヘッド有り (操作を確認したいとき)
npm run test:headed

# 対話的 UI モード (フィルタ・ステップ実行)
npm run test:ui

# レポート閲覧
npm run report
```

実行後:
- `playwright-report/index.html` … HTML レポート
- `test-results/` … 失敗時のトレース

## デモ（録画付き自動操作）

実際に Chromium を起動してアプリを操作します。実行モードは 3 通り:

| コマンド | 実行モード | 用途 |
|----|----|----|
| `npm run demo` | ヘッドレス (画面非表示) | CI / 動画と PNG だけ欲しい時 |
| `npm run demo:headed` | ヘッド有り (通常速度) | 目視確認 |
| `npm run demo:watch` | ヘッド有り + 各操作 400ms スロー | ライブ説明、社内デモ |
| `npm run demo:debug` | `PWDEBUG=1` + ヘッド有り | Playwright Inspector でステップ実行 |

スロー速度は `DEMO_SLOWMO=600 npm run demo:watch` のように環境変数で調整可。

ヘッドレス + ヘッド有りいずれの場合も、`video: "on"` の設定により全行動が
.webm 動画として録画されます。ヘッド有りで物理ディスプレイが無い CI 環境で
実行する場合は `xvfb-run -a npm run demo:headed` を使ってください。

完了後に成果物が次の場所に出力されます:

| 出力 | 場所 |
|------|------|
| 動画 (.webm) | `test-results/demo-ddd-ui-designer-end-to-end-demo-demo/video.webm` |
| ナンバリング済みスクリーンショット | `screenshots/01-app-loaded.png` 〜 `12-overview.png` |
| HTMLレポート | `playwright-report/index.html` |

デモは以下を順に実演します:

| # | 操作 | スクリーンショット |
|---|------|------------------|
| 1 | アプリ起動 | `01-app-loaded` |
| 2 | **📂 サンプルメニューを開く** | `02-sample-menu-open` |
| 3 | **Project Management サンプルを読込** | `03-sample-project-loaded` |
| 4 | 派生で P1/P3/P4/P5 が一気に出る | `04-sample-project-derived` |
| 5 | リロードして空状態に戻し、Sample → P1 | `05-default-derive-P1` |
| 6 | 名前変更とフィールド追加 | `06-edit-fields`, `07-after-edit-still-P1` |
| 7 | 多フィールド Aggregate を追加して P2 | `08-article-fields`, `09-article-derive-P2` |
| 8 | 子Entity追加で P3 (Master-Detail) | `10-article-with-children-P3` |
| 9 | UIヒントで P4 (Wizard) を強制 | `11-article-wizard-P4` |
| 10 | Singleton で P5 (Single Form) | `12-settings-P5` |
| 11 | 閾値変更で P1 ⇄ P2 を切替え | `13-threshold-flips-P2` |
| 12 | 保存と全体プレビュー | `14-saved`, `15-overview` |
| 13a | 👁 表示モードに切替 (中央エディタが畳まれる) | `16-mode-view-on` |
| 13b | 🔀 画面遷移図 / 📐 ドメイン ER 図 (右ペインが全幅で表示) | `17-view-flow-diagram`, `18-view-er-diagram` |
| 14 | **🚀 生成 → 実行** をクリック | `18-launch-clicked` |
| 15 | npm install + dev server 起動完了 | `19-launch-ready` |
| 16 | **生成された React アプリを新タブで開く** | `20-running-app-home` |
| 17 | P5 Settings 画面でフォーム入力・保存 | `21-running-app-settings`, `22-running-app-settings-saved` |
| 18 | P2 Tag 一覧から新規作成・保存 | `23-running-app-tag-list`, `24-running-app-tag-saved` |
| 19 | デザイナーパネルから dev server を停止 | `25-launch-stopped` |

連番 PNG を順に並べるだけで「設計 → パターン派生 → 動くアプリ」の
一気通貫ドキュメントになります。動画は **2 ファイル** 生成されます:

- `test-results/demo-…/video.webm` — デザイナー画面の操作
- `test-results/demo-…/video-1.webm` — 生成された React アプリ操作

### デモ全体のタイムライン

ローカル測定値（参考）:

| フェーズ | 時間 |
|----|----|
| デザイナー操作 (Step 1〜8) | 約 7s |
| 🚀 launch → ready (初回 npm install 込み) | 約 8s |
| 生成アプリ操作 (Step 11〜13) | 約 3s |
| **合計** | **約 17〜20s** |

2 回目以降は `node_modules` がキャッシュされるため launch フェーズは 2〜3 秒に短縮されます。

## CI 連携

`process.env.CI=true` のとき:
- `forbidOnly` が有効
- `retries: 2`
- `webServer` の `reuseExistingServer` が無効化

GitHub Actions で動かす場合のテンプレ:

```yaml
- uses: actions/setup-go@v5
  with:
    go-version: "1.21"
- uses: actions/setup-node@v4
  with:
    node-version: "20"
- run: npm --prefix ddd-ui-designer/ui ci
- run: npm --prefix ddd-ui-designer/e2e ci
- run: npx --prefix ddd-ui-designer/e2e playwright install --with-deps chromium
- run: npm --prefix ddd-ui-designer/e2e test
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: playwright-report
    path: ddd-ui-designer/e2e/playwright-report
```

## トラブルシューティング

| 症状 | 対処 |
|----|----|
| ポート競合 | `UI_PORT=5180 API_PORT=8099 npm test` |
| `go: not found` | Go 1.21+ をインストール、`go version` で確認 |
| ブラウザがダウンロードできない | プロキシ環境では `HTTPS_PROXY` 経由で `playwright install`、または社内のブラウザをマウント |
| webServer が立たない | `cd e2e/scripts && bash start-api.sh` を直接叩いて Go API のエラーを確認 |
| ヘッドレスでフォントが汚い | `playwright install --with-deps chromium` を実行 |
