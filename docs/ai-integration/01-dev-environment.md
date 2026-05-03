# 01. 開発環境（Dev Environment）

日常の開発ループで AI を最大活用するためのセットアップ・スキャフォールド・規約常駐・ドキュメント自動化を扱う。

---

## 1. IDE / エージェント常駐

### 1.1 推奨ツール

| ツール | 用途 | 備考 |
| --- | --- | --- |
| Claude Code (CLI) | ターミナル常駐エージェント | `CLAUDE.md` を自動読込 |
| Cursor / Windsurf / VS Code + Copilot | IDE 内補完・チャット | プロジェクト固有ルールを `.cursorrules` / `.github/copilot-instructions.md` に置く |
| Continue / Roo Code | OSS 拡張 | 自社ホストモデル接続が容易 |
| Marp for VS Code | スライドプレビュー | `docs/*.slides.md` で活用 |

### 1.2 `CLAUDE.md` 雛形

プロジェクトルートに以下を置き、すべての AI セッションが読み込むようにする。

```md
# CLAUDE.md

## アーキテクチャ
- 層: presentation / application / domain / infrastructure
- 依存方向: presentation → application → domain ◀ infrastructure
- domain 層は他層に依存禁止（react/axios/fetch/localStorage/window 不可）

## 命名
- Entity: PascalCase, 単数形
- VO: PascalCase, "Vo" suffix 不要（型で表現）
- UseCase: 動詞+目的語（例: PlaceOrderUseCase）

## ファイル配置
- domain/<context>/<aggregate>/{entity,vo,repository,events,index}.ts
- application/<context>/<usecase>.ts
- infrastructure/<context>/<repository>.ts

## 禁止事項
- domain で any
- UseCase で fetch / axios 直接利用
- React コンポーネント内でのビジネスロジック分岐

## 出力規約
- export は必ず index.ts 経由
- Date は ISO8601 文字列で表現する VO に包む
- エラーは Result<T, E> 型 (neverthrow) を優先

## テスト
- domain → vitest, GWT 構造
- application → vitest + ポートを Fake で注入
- presentation → @testing-library/react, role/label 取得
```

### 1.3 `.cursorrules` / Copilot Instructions

同等内容を IDE 別フォーマットでもミラーする。差分が出ないよう、`scripts/sync-ai-rules.ts` で `CLAUDE.md` から派生生成する運用が望ましい。

---

## 2. スキャフォールディング

### 2.1 Aggregate 雛形生成

#### プロンプト例

```md
# Task: Generate Aggregate Skeleton

## Inputs
- Context: ordering
- Aggregate: Order
- Required VOs: OrderId, CustomerId, OrderLine[], TotalAmount, OrderStatus

## Output files
- src/domain/ordering/order/order.ts
- src/domain/ordering/order/order-id.ts
- src/domain/ordering/order/order-line.ts
- src/domain/ordering/order/order-status.ts
- src/domain/ordering/order/order-repository.ts (interface)
- src/domain/ordering/order/order-events.ts
- src/domain/ordering/order/index.ts
- src/domain/ordering/order/__tests__/order.spec.ts
- src/domain/ordering/order/__tests__/order-line.spec.ts

## Rules
- すべての VO は不変、equals メソッドを持つ
- Order は Factory メソッド (Order.create) と再構成 (Order.reconstruct) を分離
- Order は OrderPlaced / OrderConfirmed イベントを発行できる
- Repository IF は save / findById / nextIdentity のみ

## Definition of Done
- tsc --noEmit pass
- vitest run src/domain/ordering green
```

#### 期待される `order.ts` の骨格

```ts
import { OrderId } from "./order-id";
import { CustomerId } from "../customer/customer-id";
import { OrderLine } from "./order-line";
import { OrderStatus } from "./order-status";
import { OrderPlaced } from "./order-events";

export class Order {
  private constructor(
    readonly id: OrderId,
    readonly customerId: CustomerId,
    private _lines: OrderLine[],
    private _status: OrderStatus,
    private _events: ReadonlyArray<unknown> = []
  ) {}

  static create(input: { id: OrderId; customerId: CustomerId; lines: OrderLine[] }): Order {
    if (input.lines.length === 0) throw new Error("Order requires at least one line");
    const order = new Order(input.id, input.customerId, input.lines, OrderStatus.Placed);
    return order.with({ events: [new OrderPlaced(input.id)] });
  }

  static reconstruct(snapshot: { id: OrderId; customerId: CustomerId; lines: OrderLine[]; status: OrderStatus }): Order {
    return new Order(snapshot.id, snapshot.customerId, snapshot.lines, snapshot.status);
  }

  get lines(): ReadonlyArray<OrderLine> { return this._lines; }
  get status(): OrderStatus { return this._status; }
  pullEvents(): ReadonlyArray<unknown> { const e = this._events; this._events = []; return e; }

  private with(patch: Partial<{ events: ReadonlyArray<unknown> }>): Order {
    const next = new Order(this.id, this.customerId, this._lines, this._status, patch.events ?? this._events);
    return next;
  }
}
```

### 2.2 UseCase 雛形

```md
# Task: Generate UseCase

## Inputs
- Name: PlaceOrderUseCase
- Input DTO: { customerId: string; items: { sku: string; quantity: number }[] }
- Output DTO: { orderId: string }
- Required ports:
  - OrderRepository (domain/ordering/order/order-repository.ts)
  - ProductCatalog  (domain/catalog/product-catalog.ts)
  - DomainEventPublisher (domain/shared/domain-event-publisher.ts)

## Rules
- DI: ports をコンストラクタ注入
- 例外でなく Result<Output, PlaceOrderError> を返す
- 副作用は Repository / Publisher 経由のみ

## Output files
- src/application/ordering/place-order.ts
- src/application/ordering/__tests__/place-order.spec.ts
```

### 2.3 React 画面雛形

- `presentation/pages/<feature>/`
  - `<Feature>Page.tsx` （ルーター直結）
  - `<Feature>Container.tsx` （UseCase 注入・状態管理）
  - `<Feature>View.tsx` （純粋な見た目）
  - `use<Feature>.ts` （hooks）
  - `<Feature>.stories.tsx` （Storybook）
  - `__tests__/<Feature>View.spec.tsx`

AI には「Container と View を分離」「View は props のみ」「Container から UseCase を呼ぶ」を明示する。

---

## 3. リファクタ支援

### 3.1 「副作用を hook から UseCase に押し出す」

```md
# Task: Refactor: Move side-effect from hook to UseCase

## Input
<選択範囲を貼り付け>

## Constraints
- hook は presentation 層、UseCase は application 層
- hook は UseCase をコンストラクタ注入相当 (useDI() で取得)
- 例外は UseCase 側で Result に変換

## Output
- 修正後の hook
- 新規/更新する UseCase
- 関連テスト
```

### 3.2 「コンポーネントから fetch を排除」

AI に **before/after の差分形式** で出力させると採否判断が早い：

```md
# Task: Remove direct `fetch` from <Component>

## Output format
1. Before / After diff (unified)
2. 新規 Repository IF（必要なら）
3. 新規 Repository 実装
4. DI 登録パッチ
```

---

## 4. ドキュメント自動化

### 4.1 ADR 自動生成

PR がマージされると、`scripts/generate-adr.ts` が以下を AI に投げる：

```md
# Task: Draft ADR

## Inputs
- Diff: <git diff main..HEAD>
- PR Title / Body
- 既存 ADR: docs/adr/*.md (直近 5 件)

## Output
docs/adr/<NNNN>-<slug>.md
- Status / Context / Decision / Consequences
- 既存 ADR との重複・矛盾があれば警告
```

### 4.2 コンテキストマップ生成（Mermaid）

```md
# Task: Generate Context Map

## Inputs
- src/domain/<context>/ ディレクトリ構造
- Repository が参照している他コンテキストの ID 型

## Output
- docs/context-map.md
- Mermaid graph で context 間関係 (CustomerSupplier / Conformist / ACL 等を推定)
```

GitHub は Mermaid をネイティブレンダリングするため、`docs/context-map.md` を直接見れる。

### 4.3 ユビキタス言語辞典の逆生成

```md
# Task: Regenerate ubiquitous language dictionary

## Inputs
- すべての src/domain/**/*.ts 内の export
- 既存 docs/ubiquitous-language.md

## Rules
- 日本語と英語を併記
- 既存定義と矛盾する場合は "DRIFT" マークを付ける
- 重複/類似語をマージ候補として提示
```

CI で `npm run check:ubiquitous-language` を回し、ドリフトを失敗にする運用が有効。

---

## 5. 開発ワークフロー支援

### 5.1 着手フェーズ

| シーン | プロンプトのコア |
| --- | --- |
| Issue 分析 | "影響レイヤ / 関連集約 / UseCase 案 / 想定 ADR を出力" |
| ライブラリ選定 | "型安全性 / bundle size / メンテナンス頻度 / ライセンスで比較表" |
| 環境構築 | "tsconfig / vite.config / package.json の差分提案と理由" |

### 5.2 実装フェーズ

```
[Issue]
  ↓ AI: 集約・UseCase 抽出
[ドメインモデル草案]
  ↓ 人間: 集約境界レビュー
[ドメイン実装]
  ↓ AI: テスト同時生成
[UseCase 実装]
  ↓ AI: ポートのモックも同時提供
[Infrastructure 実装]
  ↓ 人間: 外部 IF の整合確認
[Presentation 実装]
  ↓ AI: Storybook 同時生成
[PR]
```

### 5.3 PR 直前

- `git diff` を AI に投入し「Definition of Done」セルフチェック
- PR 説明文・コミットメッセージの自動生成
- 影響範囲（破壊的変更の有無）を AI が抽出

---

## 6. アンチパターン

| アンチパターン | 対処 |
| --- | --- |
| AI に「全部生成して」と巨大プロンプト | タスク単位で分割。1 タスク 1 プロンプト |
| `CLAUDE.md` を作って放置 | PR テンプレートに「ルール改定が必要か」を入れる |
| AI が提案した npm パッケージを無検証 install | `npm view <pkg>` で実在確認、依存数・最終更新日を必ず確認 |
| 生成コードのコメントが冗長 | `coding-style.md` に「コメントは WHY のみ」を明記 |

---

## 7. 関連ドキュメント

- [00. 前提と基本原則](./00-principles.md)
- [02. CI](./02-ci.md)
- [03. テスト](./03-testing.md)
