# AI 活用戦略 詳細ドキュメント

`react-ts × レイヤード × DIP × DI × DDD` プロジェクトにおける AI 活用を、領域ごとに深掘りしたドキュメント群。

## 目次

| # | ドキュメント | 内容 |
| --- | --- | --- |
| 00 | [前提と基本原則](./00-principles.md) | 層構成 / DIP / DI / DDD と AI 活用の原則、コンテキストエンジニアリング |
| 01 | [開発環境](./01-dev-environment.md) | IDE 統合・スキャフォールド・規約常駐・ドキュメント自動化 |
| 02 | [CI](./02-ci.md) | 層越境検知・DIP 違反検知・自動レビュー・コミット/PR 自動化 |
| 03 | [テスト](./03-testing.md) | 層別生成戦略・契約テスト・PBT・E2E・ミューテーション |
| 04 | [デバッグ](./04-debugging.md) | スタックトレース解析・再現先行・構造化ログ・CDP/DevTools |
| 05 | [パフォーマンス](./05-performance.md) | Web Vitals・Bundle 解析・Profiler・予算管理・回帰検知 |
| 06 | [領域横断の運用](./06-operations.md) | プロンプト資産化・指標・セキュリティ・段階導入 |

## 関連ドキュメント

- [`../ai-integration-strategies.md`](../ai-integration-strategies.md) — サマリー版（横断リファレンス）
- [`../ai-integration-strategies.slides.md`](../ai-integration-strategies.slides.md) — Marp スライド
- [`../ai-integration-strategies.slides.html`](../ai-integration-strategies.slides.html) — HTML スライド
- [`../ai-integration-strategies.infographic.svg`](../ai-integration-strategies.infographic.svg) — インフォグラフィック

## 読み方の推奨順序

1. **初学**：`00 → 01 → 03` の順に読み、IDE と日常開発で AI を使い始める
2. **チーム導入**：`06` を先に読んでプロンプト資産化と指標を整備、その後 `02` で CI に組み込む
3. **既存プロダクト改善**：`05 → 04` の順で計測 → 回帰調査の AI 活用を進める

## 用語の対応

| 本書での用語 | 想定具体実装の例 |
| --- | --- |
| DI コンテナ | `tsyringe`, `inversify`, `awilix`, または React Context |
| Repository | `domain` 配下の interface + `infrastructure` 配下の class 実装 |
| UseCase | `application` 配下の関数 / クラス（Application Service） |
| ポート / アダプタ | DDD の Repository / 外部サービス IF |
| ユビキタス言語 | `docs/ubiquitous-language.md` に集約された業務用語辞典 |
