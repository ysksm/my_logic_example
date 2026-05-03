# 03. テスト

層別の生成戦略・契約テスト・プロパティベーステスト・E2E・ミューテーションを AI でどう加速するか。テストは AI 出力の **検証ゲート** であり、同時に **AI が最も価値を出せる対象** でもある。

---

## 1. 全体方針

### 1.1 目的別マトリクス

| 層 | テストの主目的 | フレームワーク | AI の主役 |
| --- | --- | --- | --- |
| domain | ビジネスルール・不変条件 | vitest | ルール網羅・PBT 生成 |
| application (UseCase) | フロー・例外分岐 | vitest + Fake port | given-when-then 列挙 |
| infrastructure | 外部 IF 整合 | vitest + msw / testcontainers | 契約テスト雛形 |
| presentation | ユーザシナリオ | @testing-library/react | role/label 取得 |
| E2E | 業務シナリオ | Playwright | Gherkin → ステップ |

### 1.2 命名規約

```
src/<layer>/.../<unit>.ts
src/<layer>/.../__tests__/<unit>.spec.ts          # 単体
src/<layer>/.../__tests__/<unit>.contract.spec.ts  # 契約
src/<layer>/.../__tests__/<unit>.pbt.spec.ts       # property-based
e2e/<feature>.spec.ts                              # Playwright
```

---

## 2. ドメイン層テスト

### 2.1 何をテストするか

- **不変条件**：Entity が違反する状態に到達できないこと
- **VO の等価性**：同値 VO が `equals` で同じと判定されること
- **DomainService のビジネスルール**：価格計算、在庫引当、許可判定
- **ドメインイベント発行**：状態遷移時の発行有無・内容

### 2.2 AI 生成プロンプト

```md
# Task: Generate domain unit tests

## Inputs
- 対象: src/domain/ordering/order/order.ts
- 関連 VO: order-id.ts, order-line.ts, order-status.ts
- 業務ルール (docs/ubiquitous-language.md より):
  * Order は 1 行以上必要
  * 確定済み Order は変更不可
  * 合計金額は OrderLine の合計
  * 確定時に OrderConfirmed イベントを発行

## Rules
- vitest, GWT 構造 (describe: シナリオ, it: 期待)
- 境界値・例外ケース・正常ケースを網羅
- assert は不変条件（"少なくとも 1 行以上"等）に対しても置く
- Date を含む場合は freezeTime / vi.useFakeTimers

## Output
src/domain/ordering/order/__tests__/order.spec.ts
```

### 2.3 期待される出力例

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Order } from "../order";
import { OrderId } from "../order-id";
import { CustomerId } from "../../customer/customer-id";
import { OrderLine } from "../order-line";
import { Sku } from "../../catalog/sku";
import { Money } from "../../shared/money";

describe("Order", () => {
  describe("create", () => {
    it("少なくとも 1 行必要", () => {
      expect(() => Order.create({
        id: OrderId.of("o-1"),
        customerId: CustomerId.of("c-1"),
        lines: [],
      })).toThrowError(/at least one line/i);
    });

    it("作成時に OrderPlaced イベントを発行する", () => {
      const order = Order.create({
        id: OrderId.of("o-1"),
        customerId: CustomerId.of("c-1"),
        lines: [OrderLine.of(Sku.of("a"), 1, Money.jpy(100))],
      });
      const events = order.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ orderId: OrderId.of("o-1") });
    });
  });
});
```

### 2.4 プロパティベーステスト（fast-check）

```md
# Task: Property-based test for Money VO

## Inputs
- src/domain/shared/money.ts
- 不変条件:
  * 通貨単位が同じ Money 同士のみ加算可能
  * 加算は可換 (a+b == b+a)
  * 加算は結合的 ((a+b)+c == a+(b+c))
  * 0 加算は恒等

## Output
src/domain/shared/__tests__/money.pbt.spec.ts
```

```ts
import fc from "fast-check";

const moneyArb = fc.record({
  amount: fc.integer({ min: 0, max: 1_000_000_000 }),
  currency: fc.constantFrom("JPY", "USD"),
}).map(({ amount, currency }) => Money.of(amount, currency));

describe("Money property-based", () => {
  it("加算は可換", () => {
    fc.assert(fc.property(moneyArb, moneyArb, (a, b) => {
      fc.pre(a.currency === b.currency);
      expect(a.add(b).equals(b.add(a))).toBe(true);
    }));
  });
});
```

---

## 3. UseCase テスト

### 3.1 ポートを Fake で注入

AI に Fake 実装を同時生成させると速い：

```md
# Task: UseCase test with Fake ports

## Inputs
- 対象: src/application/ordering/place-order.ts
- ポート: OrderRepository, ProductCatalog, DomainEventPublisher

## Rules
- Fake は in-memory 実装（Mock ライブラリは使わない）
- given-when-then の describe 構造
- 異常系（在庫不足 / 不存在 SKU / 既存 OrderId 衝突）も網羅

## Output
- src/application/ordering/__tests__/place-order.spec.ts
- src/application/ordering/__tests__/_fakes/{fake-order-repository,fake-product-catalog,fake-event-publisher}.ts
```

### 3.2 期待される Fake 例

```ts
export class FakeOrderRepository implements OrderRepository {
  private store = new Map<string, Order>();
  async save(order: Order): Promise<void> { this.store.set(order.id.value, order); }
  async findById(id: OrderId): Promise<Order | null> { return this.store.get(id.value) ?? null; }
  nextIdentity(): OrderId { return OrderId.of(`o-${this.store.size + 1}`); }
}
```

### 3.3 生成テストの最小構造

```ts
describe("PlaceOrderUseCase", () => {
  let repo: FakeOrderRepository;
  let catalog: FakeProductCatalog;
  let publisher: FakeEventPublisher;
  let usecase: PlaceOrderUseCase;

  beforeEach(() => {
    repo = new FakeOrderRepository();
    catalog = new FakeProductCatalog([{ sku: "a", price: Money.jpy(100), stock: 10 }]);
    publisher = new FakeEventPublisher();
    usecase = new PlaceOrderUseCase(repo, catalog, publisher);
  });

  it("正常: 注文が保存され OrderPlaced が発行される", async () => {
    const result = await usecase.execute({ customerId: "c-1", items: [{ sku: "a", quantity: 2 }] });
    expect(result.isOk()).toBe(true);
    expect(publisher.events).toContainEqual(expect.objectContaining({ type: "OrderPlaced" }));
  });

  it("在庫不足でエラーを返す", async () => {
    const result = await usecase.execute({ customerId: "c-1", items: [{ sku: "a", quantity: 999 }] });
    expect(result.isErr()).toBe(true);
    expect(publisher.events).toHaveLength(0);
  });
});
```

---

## 4. 契約テスト（Repository conformance）

抽象（Repository IF）に対する **共通仕様** を 1 セット書き、各実装（Fake / Postgres / DynamoDB / etc.）に同じスイートを当てる。

### 4.1 共通スイート

```ts
// src/domain/ordering/order/__tests__/order-repository.contract.ts
export const orderRepositoryContract = (factory: () => OrderRepository) => {
  describe("OrderRepository contract", () => {
    let repo: OrderRepository;
    beforeEach(() => { repo = factory(); });

    it("save した Order を findById で取得できる", async () => {
      const order = sampleOrder();
      await repo.save(order);
      const got = await repo.findById(order.id);
      expect(got?.equals(order)).toBe(true);
    });

    it("nextIdentity は重複しない", () => {
      const a = repo.nextIdentity();
      const b = repo.nextIdentity();
      expect(a.equals(b)).toBe(false);
    });
  });
};
```

### 4.2 各実装で当てる

```ts
// src/infrastructure/ordering/__tests__/postgres-order-repository.contract.spec.ts
orderRepositoryContract(() => new PostgresOrderRepository(testDb));
// src/application/ordering/__tests__/_fakes/fake-order-repository.contract.spec.ts
orderRepositoryContract(() => new FakeOrderRepository());
```

### 4.3 AI 活用

- 共通スイートの **テスト項目列挙** を AI に依頼（業務ルールから網羅）
- 新実装追加時、雛形（adapter + contract spec）を AI に生成させる

---

## 5. プレゼンテーション層テスト

### 5.1 ルール

- DOM 構造ではなく **ロール / ラベル** で取得（`getByRole`, `getByLabelText`）
- View は props だけでテスト、Container は UseCase をモックで注入
- Container テストでは UseCase の Fake を再利用

### 5.2 AI プロンプト

```md
# Task: React component test

## Inputs
- Container: src/presentation/orders/place-order/PlaceOrderContainer.tsx
- View:      src/presentation/orders/place-order/PlaceOrderView.tsx
- 関連 UseCase: PlaceOrderUseCase
- 関連 Fake:    FakeOrderRepository, FakeProductCatalog

## Rules
- @testing-library/react + userEvent
- role / label / accessible name で取得
- 非同期は findBy* / waitFor を使う
- スナップショット禁止
- 「在庫不足エラー」「成功時に確認画面に遷移」「ボタン二度押し抑止」を網羅

## Output
src/presentation/orders/place-order/__tests__/PlaceOrder.spec.tsx
```

### 5.3 期待される最小例

```tsx
it("在庫不足のエラーがフォーム上に表示される", async () => {
  const repo = new FakeOrderRepository();
  const catalog = new FakeProductCatalog([{ sku: "a", price: Money.jpy(100), stock: 0 }]);
  render(<PlaceOrderContainer usecase={new PlaceOrderUseCase(repo, catalog, new FakeEventPublisher())} />);

  await userEvent.click(screen.getByRole("button", { name: "注文する" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/在庫が不足/);
});
```

---

## 6. E2E（Playwright）

### 6.1 Gherkin から生成

```md
# Task: Generate Playwright spec from Gherkin

## Input
Feature: 注文を確定する
  Scenario: 在庫がある商品を注文する
    Given ユーザは商品 SKU-A を 2 個カートに入れている
    When 注文確定ボタンを押す
    Then 注文確認画面が表示される
    And 「ご注文ありがとうございました」と表示される

## Rules
- e2e/orders.spec.ts に追記
- POM (page object model) を使う：e2e/pages/cart-page.ts, e2e/pages/order-confirm-page.ts
- 既存 helper を再利用（e2e/support/login.ts）

## Output
- e2e/orders.spec.ts
- 必要に応じて新規 page object
```

### 6.2 業務シナリオの自動洗い出し

```md
# Task: List E2E scenarios

## Inputs
- src/domain/**/events.ts
- src/application/**/*.ts (UseCase 名一覧)

## Output
ドメインイベント × UseCase の表で「最低限カバーすべき業務シナリオ」を列挙
```

---

## 7. テストデータ

### 7.1 Factory（fishery）

```ts
import { Factory } from "fishery";
import { Order } from "../order";

export const orderFactory = Factory.define<Order>(({ sequence }) =>
  Order.create({
    id: OrderId.of(`o-${sequence}`),
    customerId: CustomerId.of(`c-${sequence}`),
    lines: [OrderLine.of(Sku.of("a"), 1, Money.jpy(100))],
  })
);
```

### 7.2 AI 活用

- 集約のインバリアント満たす Factory を AI が生成
- バリエーション（"在庫切れ"・"確定済み"）の派生 trait を AI が追加

---

## 8. ミューテーションテスト（Stryker）

### 8.1 セットアップ

```jsonc
// stryker.conf.json
{
  "packageManager": "npm",
  "testRunner": "vitest",
  "mutate": ["src/domain/**/*.ts", "src/application/**/*.ts"],
  "thresholds": { "high": 90, "low": 80, "break": 70 }
}
```

### 8.2 AI による分析

```md
# Task: Survive mutant analysis

## Inputs
- Stryker の生存ミュータント JSON
- 該当ソース

## Output
- ミュータント別に「なぜ生き残ったか / どんなアサーションを足せば殺せるか」
- 追加テストの patch
```

---

## 9. カバレッジ駆動

```md
# Task: Coverage gap test generation

## Inputs
- coverage/coverage-final.json
- src/<layer>/<module>.ts

## Output
- 未カバー行に対するテストケース提案
- 既存テスト構造を踏襲した patch
```

カバレッジ 100% を狙うのではなく、**ドメイン層は 95%+、インフラは 70%+** など層別に目標を変える。

---

## 10. アンチパターン

| アンチパターン | 対処 |
| --- | --- |
| AI が DOM 構造で `getByTestId` 連発 | プロンプトで「role/label を優先」を明示 |
| Fake と本実装の振る舞い乖離 | 契約テストを必須化 |
| ミューテーション無しでカバレッジだけ高い | 不変条件アサート + 月次 mutation 実施 |
| Factory が VO の不変条件を破る | Factory 出力に対するインバリアント検証テストを追加 |

---

## 11. 関連ドキュメント

- [01. 開発環境](./01-dev-environment.md)
- [02. CI](./02-ci.md)
- [04. デバッグ](./04-debugging.md)
