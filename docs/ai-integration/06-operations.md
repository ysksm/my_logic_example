# 06. 領域横断の運用

プロンプト資産化、評価指標、セキュリティ、段階導入。AI 活用を「個人技」から「チーム能力」へ移すための運用設計。

---

## 1. プロンプト資産化

### 1.1 ディレクトリ構成

```
prompts/
├─ system/
│  ├─ architecture.md
│  ├─ coding-style.md
│  └─ output-format.md
├─ context/
│  ├─ ubiquitous-language.md   # symlink or copy from docs/
│  ├─ context-map.md
│  └─ adr/
├─ tasks/
│  ├─ generate-entity.md
│  ├─ generate-usecase.md
│  ├─ generate-test-domain.md
│  ├─ refactor-extract-usecase.md
│  ├─ review-pr.md
│  ├─ ddd-audit.md
│  ├─ web-vitals-plan.md
│  └─ profiler-analysis.md
└─ schemas/
   └─ <task>.schema.json   # 出力スキーマ（AI 検証用）
```

### 1.2 タスクプロンプトのテンプレート

```md
# Task: <短い名前>

## Inputs
- <必須入力>
- <任意入力>

## Constraints
- <禁止事項>
- <層・依存ルール>

## Output
- <ファイルパスと形式>

## Definition of Done
- tsc --noEmit pass
- <該当テスト> green
- <静的解析> 違反なし

## Examples
<good / bad の対比>
```

### 1.3 バージョン管理

- プロンプトは `git` で履歴管理し、PR レビューを通す
- 変更時は **採用率 / 再修正率** が悪化していないかメトリクスで検証
- 大改修時は `prompts/v2/` を併設し A/B 比較

---

## 2. AI 呼び出しラッパ

直接 IDE から打つだけでなく、共通ラッパ経由でも呼べるようにする。

### 2.1 役割

- システム/コンテキストを **必ず投入**（Tier 1, 2 の漏れを防止）
- 出力スキーマで自動検証
- ログ・コスト・レイテンシを記録

### 2.2 最小実装イメージ

```ts
// scripts/ai/run.ts
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";

const client = new Anthropic();
const SYSTEM = [
  fs.readFileSync("prompts/system/architecture.md", "utf8"),
  fs.readFileSync("prompts/system/coding-style.md", "utf8"),
  fs.readFileSync("prompts/system/output-format.md", "utf8"),
].join("\n\n---\n\n");

const CONTEXT = [
  fs.readFileSync("docs/ubiquitous-language.md", "utf8"),
].join("\n\n---\n\n");

export async function runTask(taskFile: string, inputs: Record<string, string>) {
  const taskBody = fs.readFileSync(taskFile, "utf8");
  const prompt = `${CONTEXT}\n\n---\n\n${taskBody}\n\n## Provided Inputs\n${JSON.stringify(inputs, null, 2)}`;
  const t0 = Date.now();
  const res = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const ms = Date.now() - t0;
  fs.appendFileSync(".ai-log.jsonl", JSON.stringify({ taskFile, ms, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }) + "\n");
  return res;
}
```

### 2.3 呼び出し例

```
npx ts-node scripts/ai/run.ts \
  --task prompts/tasks/generate-usecase.md \
  --input name=PlaceOrderUseCase \
  --input context=ordering
```

---

## 3. 評価指標（KPI）

### 3.1 量的指標

| 指標 | 取り方 | 目標 |
| --- | --- | --- |
| 採用率 | AI 提案のうち merge された割合 | 50%+ |
| 再修正率 | 採用後 7 日以内に touch される割合 | 20%- |
| 層越境違反数 | dependency-cruiser violation / 月 | 単調減 |
| 用語ドリフト件数 | drift checker / 月 | 5 件以下 |
| ミュータント検出率 | Stryker の killed / total | 80%+ |
| AI コスト/PR | tokens × 単価 | budget 内 |
| AI レビューによる改善 PR 件数 | ラベル `ai-review` の PR | 増加 |

### 3.2 質的指標

- 開発者アンケート（"AI 導入で楽になったか")
- レビュー所要時間（PR open → merge）
- 障害回数 / MTTR の推移

### 3.3 ダッシュボード

`.ai-log.jsonl` を集計して Grafana / Looker で可視化。タスク種別ごとに採用率・コスト・所要時間を追う。

---

## 4. セキュリティとプライバシ

### 4.1 マスキング

- AI に渡す前のプリプロセッサで `process.env` / `.env*` / `secrets/` を弾く
- PII（メール・電話・住所・氏名）は固定トークンに置換
- ログサンプル投入時は `pino-secrets-masking` 等で必ず通す

### 4.2 ホスティング

| 機密度 | 推奨 |
| --- | --- |
| 公開 OSS | クラウド LLM 可 |
| 業務ロジック（一般） | クラウド LLM、規約と DPA 確認 |
| 顧客データ・規制対象 | 社内ホスト LLM / ローカルモデル / VPC 経由 |

### 4.3 ハルシネーション対策

- AI が提案した npm パッケージは **必ず実在確認** (`npm view <pkg> name version`)
- 知らない API・引数は **公式 docs を WebFetch** で参照させる
- ライセンス / 著作権の確認（生成コードの来歴）

### 4.4 監査

- すべての AI 呼び出しを `.ai-log.jsonl` に記録
- 機密データ流出疑いがあれば該当ログを保存し SOC2 対応
- 生成コードを含む PR には `ai-generated` ラベルを付ける運用も検討

---

## 5. 段階導入ロードマップ

### Phase 1（Week 1〜2）：低リスク導入

- `CLAUDE.md` / `.cursorrules` 整備
- IDE 内補完
- コミットメッセージ・PR 説明文の自動生成
- 影響: 開発者個人の生産性のみ

### Phase 2（Month 1〜2）：テスト & 雛形

- ドメイン層の雛形・テスト生成プロンプト整備
- UseCase テンプレ + Fake 自動生成
- ストーリーブック雛形
- 影響: 反復作業の削減、テストカバレッジ向上

### Phase 3（Month 2〜3）：CI 自動レビュー

- dependency-cruiser / カスタム ESLint 整備
- 用語ドリフト checker
- AI レビュー（情報提供ゲートとして）
- 影響: アーキテクチャ規約の遵守率向上

### Phase 4（Month 3〜4）：パフォーマンス自動化

- Lighthouse CI / size-limit / vitest bench
- 予算超過時の AI 原因分析
- Profiler / OTel の AI 要約
- 影響: 回帰検知のリードタイム短縮

### Phase 5（Month 4〜6）：ドメインモデリング支援

- Issue → 集約候補抽出
- イベントストーミング草案生成
- ADR 自動下書き → 人間レビュー
- コンテキストマップ自動更新
- 影響: 設計判断の質と速度

> 各 Phase は **指標が改善することを確認してから次へ** 進む。逆行が見られたら戻る勇気を持つ。

---

## 6. 組織的な定着

### 6.1 役割

- **AI 推進担当**：プロンプト資産の整備、KPI モニタリング
- **アーキテクト**：層規約・ユビキタス言語の SoT 維持
- **テックリード**：AI 出力の最終レビュー基準を定義
- **開発者**：日常利用とフィードバック

### 6.2 知見共有

- 月次「AI 活用レビュー」：採用例・失敗例・プロンプト改善案を共有
- `prompts/` の PR が出たら全員レビュー対象
- 良いプロンプト・悪いプロンプトのギャラリー化

### 6.3 トレーニング

- 新規参画者向け：00〜05 ドキュメント読了 + ハンズオン
- 既存メンバー向け：四半期ごとに新機能・新モデル更新の勉強会

---

## 7. コスト管理

### 7.1 コスト発生源

| 源泉 | 主因 | 対策 |
| --- | --- | --- |
| 大きな diff の AI レビュー | 全文投入 | 200KB cap、層別分割、要約後投入 |
| 反復生成 | プロンプト不備で再生成 | プロンプト改善 |
| 不要なコンテキスト | Tier 3-4 の冗長投入 | タスクに応じた絞り込み |

### 7.2 予算

- 開発者 1 人あたり月額上限を設定（例: $100）
- ジョブごとに max_tokens を厳格化
- バッチ処理は夜間の安価モデル / 別契約に分ける

---

## 8. 退避戦略

AI が使えない / 不適切なケースに備える：

- すべての生成プロンプトは **手動でも実行可能** であること（普通の指示書）
- AI が落ちても、`prompts/tasks/*.md` を人間が読めば同じ結果に到達できる
- DI / レイヤード前提を保ち、**AI 不在でも保守可能** な構造を維持

---

## 9. 関連ドキュメント

- [00. 前提と基本原則](./00-principles.md)
- [01. 開発環境](./01-dev-environment.md)
- [02. CI](./02-ci.md)
