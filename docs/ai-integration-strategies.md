# AI 活用戦略：react-ts + レイヤードアーキテクチャ + DIP + DI + DDD

本ドキュメントは、`react-ts` をフロントエンドの基盤とし、レイヤードアーキテクチャ・依存性逆転原則 (DIP)・DI・DDD を採用したプロジェクトにおいて、AI（LLM／コーディングエージェント）をどの領域でどう活用するかをまとめたものである。

> **詳細版**：各章の深掘りドキュメントは [`ai-integration/`](./ai-integration/README.md) を参照。
> - [00. 前提と基本原則](./ai-integration/00-principles.md)
> - [01. 開発環境](./ai-integration/01-dev-environment.md)
> - [02. CI](./ai-integration/02-ci.md)
> - [03. テスト](./ai-integration/03-testing.md)
> - [04. デバッグ](./ai-integration/04-debugging.md)
> - [05. パフォーマンス](./ai-integration/05-performance.md)
> - [06. 領域横断の運用](./ai-integration/06-operations.md)

---

## 0. 全体方針

### 0.1 アーキテクチャ前提
- **層構成**：`presentation` (React) / `application` (UseCase) / `domain` (Entity・ValueObject・DomainService・Repository インターフェース) / `infrastructure` (Repository 実装・API・I/O)
- **DIP**：上位層は下位層の抽象（インターフェース）にのみ依存。`domain` 層は他層に依存しない。
- **DI**：`tsyringe` / `inversify` 等のコンテナ、もしくは React の Provider 経由で注入。
- **DDD**：ユビキタス言語で命名、集約境界の明示、ドメインイベントによる副作用の分離。

### 0.2 AI 活用の基本原則
1. **境界を超えるコードは AI に書かせない**：層またぎの依存はレビュー必須。
2. **ユビキタス言語をプロンプトに固定**：`docs/ubiquitous-language.md` を AI コンテキストに必ず投入。
3. **生成物は型と契約で検証**：`tsc --noEmit` / Schema / 契約テストで AI の出力をゲートする。
4. **AI を「層内専門家」として使う**：UseCase の AI と Repository 実装の AI を分けて指示するほど精度が上がる。

---

## 1. 開発環境（Dev Environment）

### 1.1 コードスキャフォールディング
- **集約・Entity・VO の雛形生成**：ユビキタス言語の名前を渡し、`domain/<context>/<aggregate>/` 配下に Entity / VO / Repository インターフェース / Factory を一括生成。
- **UseCase テンプレート生成**：「入力 DTO」「出力 DTO」「依存リポジトリ」を指示し、`application/<context>/<usecase>.ts` を雛形化。テストファイルもセットで生成。
- **React 画面テンプレート**：`presentation/pages/<feature>/` に、Container（UseCase 注入）/ Presentational / hooks / 型定義 / Storybook を一括出力。

### 1.2 IDE 統合
- **Claude Code / Cursor / Continue** をエディタに常駐させ、`CLAUDE.md` にアーキテクチャ規約を記述：
  - 「`domain` 層から `react` を import しない」
  - 「Repository は必ずインターフェース経由で注入」
  - 「React コンポーネントから直接 `fetch` を呼ばない」
- **スニペット生成エージェント**：選択範囲を渡し「これを UseCase に切り出して」「このフックから副作用を分離して」など、層境界を意識したリファクタを指示。

### 1.3 ドキュメント自動更新
- ADR（Architecture Decision Record）の差分要約を AI が PR ごとに生成。
- 集約マップ・コンテキストマップを `tsx` の AST から AI が抽出 → Mermaid 図として `docs/` に commit。
- ユビキタス言語辞典を `domain/` 配下の型定義から AI が逆生成し、ドリフトを検出。

### 1.4 開発ワークフロー支援
| シーン | AI 活用 |
| --- | --- |
| 新機能着手 | Issue 文面 → 集約候補・UseCase 案・影響レイヤを提案 |
| ライブラリ選定 | 候補比較表（型安全性・bundle size・メンテ状況）を生成 |
| 環境構築 | `package.json` / `tsconfig.json` / `vite.config.ts` の差分提案と理由付け |

---

## 2. CI

### 2.1 PR 自動レビュー
- **層越境チェック**：`presentation` から `infrastructure` への直接 import を AI が検出して警告。`eslint-plugin-boundaries` や `dependency-cruiser` の構成も AI に提案させる。
- **DIP 違反検知**：`domain` 層が `axios` / `fetch` / `localStorage` 等の具体実装を参照していないか AI が走査。
- **ユビキタス言語ドリフト**：辞典に未登録の業務用語を新ファイルから抽出し、用語登録 or リネームを提案。
- **DDD パターン適合性**：「Entity に setter が増えていないか」「VO が不変か」「集約境界外の参照を ID 以外で行っていないか」を AI レビュアーが指摘。

### 2.2 コミット／PR 補助
- Conventional Commits 形式でのメッセージ生成（変更ファイル群から AI が層を判定し scope を付与：`feat(domain/order)` など）。
- PR 説明文の自動生成：影響レイヤ / 追加 UseCase / DB スキーマ差分 / 必要な手動確認を構造化。
- リリースノートをドメインイベント単位で要約。

### 2.3 静的解析の補完
- TypeScript エラーや ESLint 警告を AI が一括説明＋自動修正案 PR を生成。
- 依存グラフ循環を検出した際、AI が「インターフェース抽出 + DI 経由化」のリファクタ手順を提示。
- セキュリティスキャン（`npm audit` / Snyk）の結果を AI が要約し、優先順位付け。

### 2.4 ゲーティング
- 生成 AI に依存する処理は **必ず人間レビュー or 決定論的検証（型・テスト）を間に挟む**。AI 出力をそのままマージしない。

---

## 3. テスト

### 3.1 テスト生成
- **ドメイン層**：Entity の不変条件・VO の等価性・DomainService のビジネスルールを AI が網羅的に列挙し、`vitest` ケース化。境界値とエラーケースを優先生成。
- **UseCase 層**：依存ポート（Repository / ExternalService）を AI が自動モック化し、ハッピーパス・例外フローを生成。`given-when-then` 構造を強制。
- **プレゼンテーション層**：`@testing-library/react` でユーザ操作起点のテストを生成。AI には「DOM 構造ではなくロール/ラベルで取得する」ルールを与える。
- **契約テスト**：Repository インターフェースに対して、Fake 実装と本番実装の双方が同じ振る舞いをするかの **interface conformance test** を AI が雛形生成。

### 3.2 カバレッジ駆動
- カバレッジレポート（`vitest --coverage`）を AI に投入し、未カバー行に対するテスト案を提案。
- ミューテーションテスト（Stryker）の生存ミュータントを AI が分析し、追加すべきアサーションを提案。

### 3.3 E2E / 受け入れテスト
- ユビキタス言語に沿った Gherkin シナリオを AI が生成 → Playwright のステップ実装に展開。
- ドメインイベントを起点にした「業務シナリオテスト」を AI が組み立て、UI と UseCase の整合性を検証。

### 3.4 テストデータ
- 集約のインバリアントを満たす Fixture / Factory を AI が生成（`fishery`, `@faker-js/faker` ベース）。
- プロパティベーステスト（`fast-check`）の Arbitrary を VO 単位で AI が生成し、不変条件を回帰検証。

---

## 4. デバッグ

### 4.1 エラー調査
- スタックトレース + 該当ファイル群を AI に投入し、層をまたぐ呼び出しチェーンを再構成して原因仮説を提示。
- React の `error boundary` ログを AI に渡し、「presentation で握りつぶされている UseCase 例外」を抽出。
- ソースマップと minified ログから AI が原ソース箇所を推定。

### 4.2 再現支援
- バグ報告文 → 失敗する `vitest` テストケースを AI が生成（再現テスト先行）。
- 状態遷移バグは、AI が Redux/Zustand のアクション履歴を要約し、最小再現シナリオを生成。

### 4.3 ログ／観測
- 構造化ログのスキーマを AI が提案（`correlationId`, `aggregateId`, `useCase` を必須に）。
- Sentry / OpenTelemetry のトレース要約を AI が「UseCase 単位」「集約単位」で集計し、頻発エラーを優先提示。

### 4.4 ライブデバッグ
- Chrome DevTools Protocol を介したエージェント連携（本リポジトリ内 `chrome_dev_tool_remote` のような構成）：AI が DOM/Network/Console を観測し、再現手順を提案。
- React DevTools のコンポーネントツリースナップショットを AI に渡し、不要再レンダリングの根本原因を特定。

---

## 5. パフォーマンス計測・改善

### 5.1 計測
- **フロント**：Lighthouse / Web Vitals (LCP, INP, CLS) のレポートを AI に投入し、改善優先順位と推定インパクトを表で出力。
- **バンドル**：`rollup-plugin-visualizer` の出力を AI が解析し、tree-shaking 漏れ／重複依存／巨大依存を指摘。
- **ランタイム**：React Profiler の commit 一覧を AI に渡し、再レンダリングの発生源コンポーネントを特定。

### 5.2 改善提案
- **メモ化**：`useMemo` / `useCallback` / `React.memo` の適用妥当性を AI が判定（過剰メモ化の指摘も含む）。
- **コード分割**：ルート単位の `React.lazy` 分割案を AI が `react-router` 構成から生成。
- **状態管理**：選択（selector）粒度の見直し、derived state の正規化を AI が提案。
- **ドメイン層**：純粋関数化・キャッシュ可能な計算（メモ化や `useDeferredValue`）の候補を AI が抽出。
- **インフラ層**：N+1 リクエスト、不要な polling、シリアライズコストを AI が検出。

### 5.3 回帰検知
- パフォーマンス予算（bundle size / LCP / INP）を CI に組み込み、超過時に AI が「最近の差分から原因候補」を要約 → PR コメント。
- ベンチマーク（`vitest bench` / `tinybench`）の結果差分を AI が解釈し、回帰の要因仮説を提示。

### 5.4 アーキテクチャ起因の改善
- DI コンテナの初期化コストを AI が分析し、起動時の遅延注入や `lazy provider` 化を提案。
- 集約サイズ（読み込み・書き込み単位）を AI が見直し、コマンド／クエリ分離（CQRS 寄り）の適用余地を提示。

---

## 6. 領域横断の運用ガイド

### 6.1 プロンプト資産化
- `prompts/` ディレクトリに以下を集約しバージョン管理：
  - `architecture.md`（層定義・禁止事項）
  - `ubiquitous-language.md`
  - `coding-style.md`（命名・null 安全・エラー型）
  - `test-policy.md`
- AI 呼び出し側はこれらを system prompt に必ず注入。

### 6.2 評価とフィードバック
- AI の修正提案採用率／再修正率を計測し、プロンプトを改善。
- 品質指標：層越境違反数、ユビキタス言語ドリフト件数、生成テストの有効性（ミュータント検出率）。

### 6.3 セキュリティ／プライバシ
- ドメイン層のソースコードは社内 LLM またはローカル LLM のみで扱う運用を選択肢に。
- シークレット・PII を AI に渡さないためのプリプロセッサ（マスキング）を必須化。

### 6.4 段階導入ロードマップ
1. **Phase 1**：IDE 補完・コミットメッセージ・PR 説明文生成（低リスク）
2. **Phase 2**：テスト生成・ドメイン層リファクタ提案
3. **Phase 3**：CI 自動レビュー（層越境・DIP 違反検知）
4. **Phase 4**：パフォーマンス回帰の自動原因分析・自動 PR
5. **Phase 5**：ドメインモデリング支援（イベントストーミング草案生成等）

---

## 7. まとめ

DDD + レイヤード + DIP + DI という構造は、**AI への「責務分割した指示」**と非常に相性が良い。層ごとに役割を限定し、ユビキタス言語と契約（型・インターフェース）を AI コンテキストに固定することで、生成物の品質と検証容易性が大きく向上する。

導入時は「決定論的検証（型・テスト・静的解析）を AI 出力の前段に必ず置く」ことを徹底し、AI を **設計判断の補助** と **反復作業の自動化** の両面で活用していく。
