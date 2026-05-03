# 05. パフォーマンス計測・改善

計測 → 仮説 → 改善 → 回帰検知のサイクルに AI を組み込む。AI に **生データ + アーキテクチャ規約** を渡し、層単位での改善案を出させる。

---

## 1. 計測の基本セット

| 領域 | ツール | 取得指標 |
| --- | --- | --- |
| Lab 計測 | Lighthouse CI | LCP / INP / CLS / TBT / TTI |
| Field 計測 | web-vitals + 自社収集 | LCP / INP / CLS の分布 |
| バンドル | rollup-plugin-visualizer / esbuild-analyze | size / dependency tree |
| ランタイム | React DevTools Profiler | commit / render time |
| API | OpenTelemetry / Server-Timing | server time / DB time |
| Bench | vitest bench / tinybench | 関数単位ベンチ |

---

## 2. Web Vitals 改善

### 2.1 AI 要約プロンプト

```md
# Task: Web Vitals improvement plan

## Inputs
- Lighthouse JSON (lab)
- web-vitals 集計 (field, p75)
- 主要ページの URL と役割

## Rules
- LCP / INP / CLS のうち、p75 が閾値超えのものを優先
- ボトルネック仮説と推定インパクトを表形式で
- 実装影響レイヤを明示（presentation / infrastructure）

## Output
| 指標 | 現在 p75 | 目標 | 仮説 | 改善案 | 推定インパクト | 影響レイヤ | 推定工数 |
```

### 2.2 LCP 改善のアプローチ

| 原因 | 改善 | AI に出させる粒度 |
| --- | --- | --- |
| 画像読み込み | `loading="eager"` + `fetchpriority="high"` + 適切な `srcset` | コンポーネント単位の patch |
| フォント | `font-display: swap` + preload | CSS / `<link>` patch |
| サーバ応答 | キャッシュ戦略・SSR 化 | infrastructure 修正 |

### 2.3 INP 改善

- **長いタスク** を Profiler から特定
- メモ化漏れではなく **計算/シリアライズの過多** が真因のことが多い
- AI には「Long Task の発生関数 + 呼び出し側」を渡し、`useDeferredValue` / `startTransition` / Web Worker への切り出し案を出させる

---

## 3. バンドル解析

### 3.1 AI による要約

```md
# Task: Bundle audit

## Inputs
- visualizer の treemap JSON
- package.json
- src/ ディレクトリ構造

## Output
1. サイズ Top 10 依存と用途
2. 重複依存 (例: lodash と lodash-es 両方)
3. tree-shaking 漏れ ("default export only" や副作用 import)
4. ルート単位の分割漏れ（特定ルートでだけ必要なものが共通バンドルに）
5. 改善 patch
```

### 3.2 改善パターン

| 症状 | 改善 |
| --- | --- |
| `moment` が含まれる | `date-fns` / `dayjs` へ移行 |
| `lodash` 全体 import | `lodash-es` の名前付き import に置換 |
| 大きな ICU や i18n | 言語別にチャンク分割 |
| 図表系 (chart.js / d3) | route lazy + dynamic import |

### 3.3 React.lazy 案の生成

```md
# Task: Route-level code splitting plan

## Inputs
- src/presentation/router.tsx
- visualizer の per-chunk size
- 各ルートの初期表示頻度（GA / 自社計測）

## Output
- ルート別に lazy 化推奨 / 不要を判定
- 修正 diff（React.lazy + Suspense fallback）
- 影響を受けるテスト
```

---

## 4. React Profiler 解析

### 4.1 取得手順

1. React DevTools の Profiler で記録
2. `Export` で JSON 取得
3. AI に投入

### 4.2 プロンプト

```md
# Task: Profiler analysis

## Inputs
- profiler.json
- 主要コンポーネントツリー（src/presentation/...）

## Output
1. commit 数 / トータル / 1 commit あたり平均 / 最長
2. 再描画頻度上位コンポーネント
3. 不要再描画の根本原因
   - props 参照変更 (新規オブジェクト/関数)
   - context 値の変動
   - selector 粒度
4. メモ化が有効な箇所 / 過剰なメモ化
5. 改善 diff
```

### 4.3 メモ化の判定原則

- **render が重い** + **props が安定** → `React.memo`
- **計算が重い** + **入力が安定** → `useMemo`
- **子に function を渡す** + **子が memo** → `useCallback`
- それ以外は **メモ化しない**（コストの方が高い）

AI に「メモ化過剰」も指摘させるのが重要。

---

## 5. 状態管理のチューニング

### 5.1 selector 粒度

```md
# Task: Selector audit

## Inputs
- src/presentation/state/store.ts
- selectors と consumer コンポーネントの一覧

## Output
- 過大粒度 selector（不要再描画を起こす）
- shallowEqual 化候補
- derived state 正規化案
- "computed selector" を memoize する候補（reselect）
```

### 5.2 derived state

サーバ状態とクライアント状態が混在する場合、AI に **責務分離案** を出させる：

- サーバ状態：TanStack Query / RTK Query
- フォーム状態：React Hook Form / Conform
- UI 状態：useState / useReducer
- ドメイン由来の derived: `useMemo` で計算

---

## 6. ドメイン層のパフォーマンス

純粋関数主体なので最適化余地は限定的だが：

### 6.1 メモ化

```md
# Task: Memoize pure domain calculations

## Inputs
- src/domain/<module>.ts
- 利用側 hook / UseCase

## Rules
- 純粋関数のみ対象
- キャッシュキーは VO の equals / hash で生成
- メモ化はドメイン層に置かず、application 側のキャッシュサービスで実装

## Output
- ApplicationService 側のキャッシュ実装
- 妥当な TTL / invalidation 戦略
```

### 6.2 集約サイズの見直し

集約が大きすぎると I/O とシリアライズで詰まる：

```md
# Task: Aggregate size review

## Inputs
- src/domain/<context>/<aggregate>/
- Repository.findById のクエリプラン (EXPLAIN)

## Output
- 集約境界の見直し提案（分割 / 別集約への参照に）
- read 専用の専用クエリ（CQRS 寄り）導入の妥当性
- イベント化の余地
```

---

## 7. インフラ層のパフォーマンス

### 7.1 N+1 検出

```md
# Task: N+1 detection

## Inputs
- 1 リクエストで発生したクエリログ
- 該当 Repository 実装

## Output
- N+1 になっている箇所
- バッチ取得 / JOIN への書き換え
- DataLoader 導入の妥当性
```

### 7.2 不要 polling / 重複リクエスト

- TanStack Query の `staleTime` / `gcTime` 設定
- focus / mount 時の重複 fetch
- `prefetchQuery` の活用余地

AI に query クライアント設定全体を渡してチューニング案を出させる。

### 7.3 シリアライズコスト

巨大 JSON のパースや構造化クローンが原因のことがある：

- `JSON.parse` を Worker に逃がす
- バイナリ表現（msgpack / protobuf）への切替
- ストリーミング JSON

---

## 8. 予算とゲート

### 8.1 パフォーマンス予算（CI）

```yaml
# size-limit.config.cjs (例)
module.exports = [
  { path: "dist/assets/index-*.js", limit: "200 KB" },
  { path: "dist/assets/orders-*.js", limit: "60 KB" },
];
```

### 8.2 LCP / INP 予算

```yaml
- name: Lighthouse CI
  uses: treosh/lighthouse-ci-action@v12
  with:
    urls: |
      http://localhost:4173/
      http://localhost:4173/orders
    budgetPath: .lighthouseci/budget.json
```

### 8.3 予算超過時の AI コメント

```md
# Task: Regression diagnosis

## Inputs
- 予算超過した指標と差分
- 直近の PR 一覧 + 変更ファイル
- visualizer の chunk 差分

## Output
- 原因候補 PR の上位 3 つ（根拠付き）
- 各々の最小ロールバック範囲
- 代替の最適化案
```

---

## 9. ベンチマーク

### 9.1 vitest bench

```ts
import { bench } from "vitest";
bench("Order.create", () => {
  Order.create({ id: OrderId.of("o-1"), customerId: CustomerId.of("c-1"), lines: sampleLines });
});
```

### 9.2 結果差分の AI 解釈

```md
# Task: Bench regression

## Inputs
- bench result base / head
- 該当差分

## Output
- 有意差のある関数
- 推定原因
- ロールバック / 改善 patch
```

---

## 10. アンチパターン

| アンチパターン | 対処 |
| --- | --- |
| 計測なしに最適化 | 必ず Lab + Field の数値から始める |
| メモ化乱用 | Profiler で実害確認後にのみ追加。AI に過剰メモ化指摘も依頼 |
| バンドル分割しすぎ | network round-trip コストとのバランス。chunk 数 KPI を持つ |
| ドメイン層に DB 都合の最適化 | 集約は業務に従う。クエリ最適化は infrastructure / read model 側で |

---

## 11. 関連ドキュメント

- [04. デバッグ](./04-debugging.md)
- [02. CI](./02-ci.md)
- [06. 領域横断の運用](./06-operations.md)
