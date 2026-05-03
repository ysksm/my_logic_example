---
marp: true
theme: default
paginate: true
size: 16:9
header: 'AI 活用戦略 / react-ts × DDD'
footer: '© my_logic_example'
---

<!--
GitHub 上では通常の Markdown として閲覧できます。
スライドとして見るには:
  npx @marp-team/marp-cli docs/ai-integration-strategies.slides.md --html
  npx @marp-team/marp-cli docs/ai-integration-strategies.slides.md --pdf
VS Code: 拡張機能 "Marp for VS Code" でプレビュー。
-->

# AI 活用戦略
## react-ts + レイヤード + DIP + DI + DDD

開発環境 / CI / テスト / デバッグ / パフォーマンス

---

## 0. 前提アーキテクチャ

- **層構成**
  - `presentation` (React)
  - `application` (UseCase)
  - `domain` (Entity / VO / DomainService / Repository IF)
  - `infrastructure` (Repository 実装 / API / I/O)
- **DIP**：上位層は抽象（IF）にのみ依存
- **DI**：`tsyringe` / `inversify` / Provider 経由
- **DDD**：ユビキタス言語 / 集約境界 / ドメインイベント

---

## 0. AI 活用の基本原則

1. **境界を超えるコードは AI に書かせない**（層またぎは人間レビュー）
2. **ユビキタス言語をプロンプトに固定**（`docs/ubiquitous-language.md` を投入）
3. **生成物は型と契約で検証**（`tsc --noEmit` / Schema / 契約テスト）
4. **AI を「層内専門家」として使う**（UseCase 用と Repository 用を分離）

> AI 出力の前段に **決定論的検証** を必ず置く

---

## 1. 開発環境（1/2）スキャフォールド & IDE

- **集約・Entity・VO の雛形生成**
  ユビキタス言語 → `domain/<context>/<aggregate>/` 一括生成
- **UseCase テンプレ**
  入力 DTO / 出力 DTO / 依存ポート + テストファイル一式
- **React 画面テンプレ**
  Container / Presentational / hooks / Storybook
- **`CLAUDE.md` 規約をエディタ常駐**
  - `domain` から `react` を import しない
  - Repository は IF 経由で注入
  - コンポーネントから直接 `fetch` 禁止

---

## 1. 開発環境（2/2）ドキュメント & ワークフロー

- **ADR 差分要約** を PR ごとに自動生成
- **集約マップ / コンテキストマップ** を AST から Mermaid 化
- **ユビキタス言語辞典** を型定義から逆生成 → ドリフト検出

| シーン | AI 活用 |
| --- | --- |
| 新機能着手 | Issue → 集約候補・UseCase 案・影響レイヤ提案 |
| ライブラリ選定 | 比較表（型安全 / size / メンテ） |
| 環境構築 | `tsconfig` / `vite.config` 差分提案 |

---

## 2. CI（1/2）自動レビュー

- **層越境チェック**
  `presentation → infrastructure` 直 import を検出
- **DIP 違反検知**
  `domain` 層が `axios` / `localStorage` を参照していないか
- **ユビキタス言語ドリフト**
  辞典未登録の業務用語を抽出
- **DDD パターン適合性**
  Entity に setter 増加 / VO 不変性 / 集約境界外参照を指摘

---

## 2. CI（2/2）コミット & ゲーティング

- **Conventional Commits 自動生成**
  scope に層を反映：`feat(domain/order): ...`
- **PR 説明文の構造化**
  影響レイヤ / 追加 UseCase / DB 差分 / 手動確認項目
- **リリースノートをドメインイベント単位で要約**
- **ゲーティング**
  AI 出力 → 型 / テスト / 人間レビューを必ず通す

---

## 3. テスト（1/2）層別生成

- **domain**
  Entity 不変条件 / VO 等価性 / DomainService ルールを網羅生成
- **application (UseCase)**
  ポートを自動モック化、given-when-then を強制
- **presentation**
  `@testing-library/react`、ロール / ラベル取得を強制
- **契約テスト (interface conformance)**
  Repository IF に対して Fake / 本実装の整合を検証

---

## 3. テスト（2/2）カバレッジ・E2E・データ

- **カバレッジ駆動**
  未カバー行 → 追加ケース提案
- **ミューテーションテスト (Stryker)**
  生存ミュータント → 追加アサーション提案
- **E2E**
  ユビキタス言語に沿った Gherkin → Playwright ステップ
- **テストデータ**
  集約インバリアントを満たす Factory / `fast-check` Arbitrary

---

## 4. デバッグ（1/2）原因調査 & 再現

- **エラー調査**
  スタックトレース + 該当ファイル群 → 呼び出しチェーン再構成
- **error boundary ログ**
  presentation で握り潰された UseCase 例外を抽出
- **再現支援**
  バグ報告文 → 失敗する `vitest` ケースを先に生成
- **状態遷移バグ**
  Redux / Zustand のアクション履歴から最小再現

---

## 4. デバッグ（2/2）ログ & ライブ

- **構造化ログスキーマ提案**
  `correlationId` / `aggregateId` / `useCase` を必須化
- **Sentry / OTel トレース要約**
  UseCase 単位 / 集約単位で集計
- **CDP 連携（本リポジトリの `chrome_dev_tool_remote` 例）**
  DOM / Network / Console を AI が観測 → 再現手順
- **React DevTools スナップショット**
  不要再レンダリングの根本原因特定

---

## 5. パフォーマンス（1/2）計測

- **フロント計測**
  Lighthouse / Web Vitals (LCP, INP, CLS) を AI が要約
- **バンドル解析**
  `rollup-plugin-visualizer` → tree-shaking 漏れ / 重複依存検出
- **ランタイム**
  React Profiler の commit から再レンダリング発生源を特定

---

## 5. パフォーマンス（2/2）改善

- **メモ化判定**
  `useMemo` / `useCallback` / `React.memo` の過不足
- **コード分割**
  `react-router` 構成から `React.lazy` 案を生成
- **状態管理**
  selector 粒度・derived state 正規化
- **インフラ層**
  N+1 / 無駄な polling / シリアライズコスト検出
- **回帰検知**
  bundle / LCP / INP 予算超過時に AI が原因候補を PR コメント

---

## 6. 領域横断の運用

- **プロンプト資産化** (`prompts/` を VCS 管理)
  - `architecture.md` / `ubiquitous-language.md`
  - `coding-style.md` / `test-policy.md`
- **評価指標**
  - 採用率 / 再修正率
  - 層越境違反数 / 用語ドリフト件数 / ミュータント検出率
- **セキュリティ**
  - シークレット・PII マスキング必須
  - 機密領域はローカル LLM 運用も選択肢に

---

## 6. 段階導入ロードマップ

1. **Phase 1**：IDE 補完・コミット文・PR 説明文（低リスク）
2. **Phase 2**：テスト生成・ドメイン層リファクタ提案
3. **Phase 3**：CI 自動レビュー（層越境・DIP 違反）
4. **Phase 4**：パフォーマンス回帰の自動原因分析・自動 PR
5. **Phase 5**：ドメインモデリング支援（イベントストーミング草案）

---

## 7. まとめ

- DDD + レイヤード + DIP + DI は **AI への責務分割指示** と相性が良い
- **層 × ユビキタス言語 × 契約（型・IF）** をコンテキストに固定
- AI 出力の前段に **決定論的検証** を必ず置く
- AI は「**設計判断の補助**」と「**反復作業の自動化**」の二刀流で

---

# 質疑・議論
