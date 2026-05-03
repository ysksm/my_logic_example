# 00. 前提と基本原則

AI 活用の質は **AI に渡すコンテキスト** と **生成物の検証手段** で決まる。本章はその土台となる前提とルールを定義する。

---

## 1. アーキテクチャ前提

### 1.1 ディレクトリ構成（推奨）

```
src/
├─ presentation/      # React コンポーネント / hooks / Container
│  └─ <feature>/
├─ application/       # UseCase / Application Service / DTO
│  └─ <context>/
├─ domain/            # Entity / VO / DomainService / Repository IF / DomainEvent
│  └─ <context>/<aggregate>/
├─ infrastructure/    # Repository 実装 / API クライアント / Storage
│  └─ <context>/
└─ di/                # DI コンテナ設定（tsyringe / inversify など）
```

### 1.2 依存方向のルール

```
presentation ──▶ application ──▶ domain ◀── infrastructure
                                     ▲
                                     └─ DIP: infrastructure は domain の IF を実装する
```

- `domain` は **どこにも依存しない**（React も axios も import しない）
- `application` は `domain` のみに依存（infrastructure には DI 経由でしか触れない）
- `infrastructure` は `domain` の IF を実装する

### 1.3 DI の責務

- **コンポジションルート**：`src/di/container.ts` 一箇所でのみ具体実装をバインド
- **テスト時**：コンテナを差し替えて Fake / Stub / Mock を注入
- **AI に書かせる範囲**：UseCase は IF だけを参照する純粋ロジックとして書かせ、コンテナ設定は人間が承認

---

## 2. AI 活用の基本原則

### 2.1 4 原則

1. **境界越境コードは AI に書かせない**
   層をまたぐ import を含む生成は禁止。AI が必要としても、UseCase からインフラを直接呼ぶようなコードは却下する。
2. **ユビキタス言語をプロンプトに固定**
   `docs/ubiquitous-language.md` を system prompt or context として常に投入する。
3. **生成物は型と契約で検証**
   `tsc --noEmit` / `eslint` / `vitest` / 契約テストを通過しないコードはマージしない。AI 出力は CI ゲートの **手前** に立つ。
4. **AI は層内専門家として使い分ける**
   「ドメイン専用の AI セッション」「UseCase 専用の AI セッション」のように責務を分けて指示するほど精度が上がる。

### 2.2 アンチパターン

| アンチパターン | 何が悪いか |
| --- | --- |
| 「全部やって」と一発生成 | 層越境やビジネスルール違反が混入 |
| ユビキタス言語の不一致を許容 | ドリフトが蓄積し、設計図と実装が乖離 |
| AI 出力を型エラーまま `// @ts-ignore` で握り潰す | 検証ゲートが無効化、後続の AI が間違った前提を学習 |
| 生成テストを「全部 green」だけで採用 | 不変条件をアサートせずカバレッジだけ稼ぐ無価値テスト |

---

## 3. コンテキストエンジニアリング

AI に渡すコンテキストを **4 階層** で整理する。

### 3.1 Tier 1：恒常的（system prompt）

| 内容 | 例 |
| --- | --- |
| アーキテクチャ規約 | 層構成・依存方向・禁止事項 |
| コーディング規約 | null 安全・エラー型・命名 |
| 出力形式 | TypeScript / Vitest / Conventional Commits |

### 3.2 Tier 2：プロジェクト全体（毎セッション投入）

- ユビキタス言語辞典
- コンテキストマップ
- 主要 ADR（直近 5 件）

### 3.3 Tier 3：タスク固有（タスクごとに切替）

- 関連集約の Entity / VO 定義
- 関連 UseCase の入出力 DTO
- 関連 Repository IF

### 3.4 Tier 4：揮発性（エージェントが都度収集）

- スタックトレース・テスト失敗ログ
- DOM スナップショット・ネットワークトレース

> Tier 1 と Tier 2 は `prompts/` 配下に **VCS で管理** し、AI 呼び出し側のラッパが必ず読み込む。

---

## 4. プロンプト資産の構造

```
prompts/
├─ system/
│  ├─ architecture.md          # 層・DIP・DI・DDD のルール
│  ├─ coding-style.md          # 命名 / null / エラー / インポート規則
│  └─ output-format.md         # 出力フォーマット指示
├─ context/
│  ├─ ubiquitous-language.md
│  ├─ context-map.md
│  └─ adr/
│     └─ 0001-*.md
└─ tasks/
   ├─ generate-entity.md
   ├─ generate-usecase.md
   ├─ generate-test-domain.md
   ├─ refactor-extract-usecase.md
   └─ review-pr.md
```

### 4.1 タスクプロンプトの最小テンプレート

```md
# Task: <何を生成するか>

## Inputs
- 集約: <Aggregate 名>
- 関連 VO: <VO 名一覧>
- 業務ルール: <要件記述>

## Constraints
- 出力先: src/domain/<context>/<aggregate>/
- 依存禁止: react / axios / fetch / localStorage / window / process
- 使用許可: 標準 JS / 自プロジェクト内 domain 型

## Definition of Done
- `tsc --noEmit` を通る
- `vitest run src/domain/<context>` が green
- export は index.ts 経由
```

---

## 5. 検証ゲートの多重化

AI 出力は **必ず複数のゲート** を通す。

```
[AI 出力]
   ↓
(1) prettier + eslint  ── スタイル/構文
   ↓
(2) tsc --noEmit       ── 型整合性
   ↓
(3) dependency-cruiser ── 層越境/DIP違反
   ↓
(4) vitest run         ── 単体・契約テスト
   ↓
(5) 人間レビュー        ── 設計判断・命名
   ↓
[マージ]
```

- ゲートを **AI に教えておく**：プロンプトの "Definition of Done" に書く
- AI 自身に **セルフチェック** させる前段としても機能（出力前に「上記ゲートを満たすか」を自問させる）

---

## 6. 役割分担マトリクス

| 役割 | 人間 | AI |
| --- | --- | --- |
| ドメインモデリング（境界決定） | ◎ | △（草案生成） |
| ユビキタス言語の決定 | ◎ | △（候補抽出） |
| Entity / VO の実装 | ○ | ◎（テスト同時生成） |
| UseCase の実装 | ○ | ◎ |
| Repository IF の決定 | ◎ | △ |
| Repository 実装 | △ | ◎ |
| React コンポーネント実装 | ○ | ◎ |
| テスト生成 | △ | ◎ |
| パフォーマンス測定の計画 | ◎ | ○ |
| ログ・トレース要約 | △ | ◎ |
| アーキテクチャ判断 | ◎ | △ |

> ◎ = 主担当 / ○ = 補助 / △ = 補佐レビュー

---

## 7. セキュリティとプライバシ

- **PII / シークレットを AI に渡さない**：`.env` / 顧客データ / 個人情報をマスキングするプリプロセッサを必須化
- **ドメインコードの取り扱い**：機密性の高いドメインはローカル LLM or 社内ホスト LLM で運用
- **生成物の出所追跡**：AI が生成したコードを `git` の co-author 表記やコミット trailer で記録する運用を検討
- **依存パッケージ提案の検証**：AI が提案した npm パッケージは **必ず実在性確認**（hallucinated package 攻撃の対策）

---

## 8. 次に読むべきドキュメント

- [01. 開発環境](./01-dev-environment.md)
- [06. 領域横断の運用](./06-operations.md)
