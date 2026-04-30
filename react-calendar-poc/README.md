# React Calendar POC

Google Calendar 風の予定 / 工数管理 UI のプロトタイプです。

## 機能

- 4 種類の表示モード
  - **1日**: 1日分の時間軸（30分刻み）
  - **5日**: 平日5日分の時間軸（営業日ビュー）
  - **7日**: 週ビュー
  - **1ヶ月**: 月間グリッド
- ドラッグ操作なしのシンプルなクリック / タップで予定を新規作成
- タイトル・開始/終了時刻・**工数(h)**・色・メモを入力できるイベントモーダル
- 既存イベントのクリックで編集・削除
- ヘッダーで前後移動 / 「今日」へジャンプ
- 各日の合計工数を週/月ビューで自動集計
- `localStorage` に保存されるので再読み込みしてもデータが残る

## 起動

```bash
cd react-calendar-poc
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開いてください。

## ビルド

```bash
npm run build
npm run preview
```

## 技術スタック

- React 18 + TypeScript
- Vite
- 標準 `Date` のみ使用（外部の日付ライブラリ非依存）
