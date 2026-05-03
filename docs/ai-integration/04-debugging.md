# 04. デバッグ

「再現テストを先に書く」「層単位でログを構造化する」を AI で加速する。AI は **観測データの要約と仮説生成** に最も価値がある。

---

## 1. 調査フローの再設計

```
バグ報告
  ↓ (1) 再現テストを先に書く ── AI が雛形生成
  ↓ (2) 失敗するテストを確認
  ↓ (3) スタックトレース + 関連層を特定 ── AI が依存関係を要約
  ↓ (4) 仮説リスト ── AI が複数候補を出す
  ↓ (5) 最小修正
  ↓ (6) 再現テストが green
  ↓ (7) 回帰テストとしてマージ
```

---

## 2. 再現テスト先行（Red First）

### 2.1 プロンプト

```md
# Task: Generate failing reproduction test

## Inputs
- バグ報告: <ユーザ報告文>
- 関連 UseCase: PlaceOrderUseCase
- 既存テスト: src/application/ordering/__tests__/place-order.spec.ts

## Rules
- 再現するテストを 1 ケースだけ追加
- 既存 Fake / Factory を再利用
- まず失敗することを確認するため、修正コードは含めない
- describe に "[bug-1234]" のタグを付ける

## Output
- 追加するテストケースの diff
- テスト実行コマンド
```

### 2.2 再現が難しい場合

- **状態遷移バグ**：Redux/Zustand のアクション履歴を AI に渡し、最小再現シーケンスを抽出
- **タイミング依存**：AI に `vi.useFakeTimers` の使い方と期待スケジュールを書かせる
- **競合状態**：`fast-check` で乱数化したスケジュールを試す PBT に変換

---

## 3. スタックトレース解析

### 3.1 投入する情報

| 種別 | 取得元 |
| --- | --- |
| stacktrace | エラーログ / Sentry |
| 該当ファイル全文 | `git show HEAD:<file>` |
| 関連層の IF 定義 | `domain/.../<repository>.ts` |
| 直近の変更 | `git log --oneline -- <file>` |

### 3.2 プロンプト

```md
# Task: Investigate stacktrace

## Inputs
<stacktrace>
<該当ファイル群>
<関連 IF>
<直近 5 コミット>

## Output
1. 例外発生地点と層
2. 呼び出しチェーン（presentation → application → domain → infrastructure）の再構成
3. 仮説 (3 つ以上、各々の根拠と検証方法)
4. 各仮説に対する最小修正パッチ案
```

### 3.3 ソースマップ前提

- 本番ビルドのスタックトレースは minified。Sentry のソースマップを必ずアップロード
- AI には **元ソースで** 投入する

---

## 4. error boundary で握り潰される例外

React の `componentDidCatch` 等で UseCase 例外が消える事故を防ぐ。

### 4.1 規約

- error boundary は **ログ + ユーザ向け fallback** のみ。例外を吸収して握り潰さない
- UseCase は `Result<T, E>` を返し、例外は外部 IO のみ
- 握り潰された例外検出のため、Sentry 等で必ず capture

### 4.2 AI による検出

```md
# Task: Find swallowed errors

## Inputs
- src/presentation/**/*.tsx
- src/presentation/**/error-boundary.tsx

## Check
- catch / componentDidCatch で console.error のみで終わっていないか
- Promise.catch で空関数を渡していないか
- error boundary が fallback だけで logging を呼んでいないか

## Output
箇所と修正案
```

---

## 5. 構造化ログ

### 5.1 スキーマ（必須フィールド）

```ts
type LogRecord = {
  ts: string;                  // ISO8601
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  correlationId: string;       // リクエスト/操作単位
  causationId?: string;        // 連鎖
  useCase?: string;            // PlaceOrderUseCase
  aggregate?: { type: string; id: string };
  layer: "presentation" | "application" | "domain" | "infrastructure";
  context?: Record<string, unknown>;
};
```

### 5.2 AI による設計支援

```md
# Task: Audit log fields

## Inputs
- src/infrastructure/logger/*.ts
- src/application/**/*.ts (UseCase)
- 既存ログサンプル 50 件

## Output
- 未付与の必須フィールド（correlationId 等）の指摘
- UseCase 単位での causationId 付与漏れ
- ログレベルの不適切利用（domain で warn 多発など）
```

---

## 6. Sentry / OpenTelemetry の要約

### 6.1 サマリプロンプト

```md
# Task: Daily error digest

## Inputs
- 過去 24h の Sentry events (JSON)
- 既知 Issue 一覧

## Output
- 件数 / 影響ユーザ数 / 増減率 上位
- UseCase 単位、集約単位での集計
- 新規 / 既知の分類
- 推奨アクション (作成すべき Issue / 優先度)
```

### 6.2 トレース要約

OTel スパンを「UseCase 単位の業務フロー」に再構成すると読みやすい：

```md
# Task: Summarize trace

## Inputs
- OTel spans (JSON)

## Output
- ルート: <UseCase 名>
- 子スパンを「ドメイン操作 / Repository / 外部 API / DB」で分類
- 遅延が大きいスパンを上位 3 つ列挙
- 異常終了したスパン
```

---

## 7. ライブデバッグ（CDP / DevTools）

### 7.1 Chrome DevTools Protocol 連携

本リポジトリ内 `chrome_dev_tool_remote` のような構成で、AI エージェントが：

- DOM ツリースナップショット
- Network ログ
- Console メッセージ
- パフォーマンスタイムライン

を取得し、仮説生成に使う。

```md
# Task: Reproduce from DOM/network

## Inputs
- 失敗時の DOM snapshot
- Network HAR
- Console errors
- ユーザ操作シーケンス（クリック・入力ログ）

## Output
- 失敗の直前状態
- 再現手順 (Playwright スクリプト)
- 仮説と修正案
```

### 7.2 React DevTools

- **Profiler**：commit ごとの再描画コンポーネントを AI に渡し、不要再レンダ原因を特定
- **Components**：props/state スナップショット差分から、状態の不正遷移を検出

---

## 8. データ起因バグ

### 8.1 マイグレーション差分

DB スキーマ変更時に AI に投入：

```md
# Task: Migration impact

## Inputs
- ALTER TABLE 等の migration ファイル
- src/infrastructure/<context>/*-repository.ts
- 関連 Entity / VO

## Output
- 影響を受ける Repository / Entity
- 後方互換性の懸念
- 既存データのバックフィル必要性
```

### 8.2 不正データの検出

```md
# Task: Find invalid records

## Inputs
- VO のバリデーションロジック (例: src/domain/shared/email.ts)
- 本番からエクスポートしたサンプル CSV (PII マスク済み)

## Output
- バリデーションを満たさないレコード件数
- 修正 / 隔離 / 削除の判断材料
```

---

## 9. パフォーマンス起因バグ

「遅い」ではなく「タイムアウトする / 落ちる」が出るケース：

- N+1 クエリで TIMEOUT
- 巨大集約のロードでメモリ超過
- 過剰再レンダで `setState` が固まる

→ [05. パフォーマンス](./05-performance.md) と連携。AI に **実行ログと該当コード両方** を渡して根本原因を出させる。

---

## 10. ポストモーテム

### 10.1 AI による下書き

```md
# Task: Postmortem draft

## Inputs
- インシデントタイムライン
- 原因コミット / PR
- 影響範囲（ユーザ数・データ）
- 既存 ADR / runbook

## Output
- 5W1H サマリ
- 直接原因 / 根本原因
- 検出が遅れた理由
- 再発防止策（プロセス / 技術）
- アクション項目（担当・期限）
```

人間がタイムラインの解釈と再発防止策の決定を担い、定型部分は AI が書く。

---

## 11. アンチパターン

| アンチパターン | 対処 |
| --- | --- |
| AI に「なぜ動かない？」と曖昧投入 | スタックトレース + 該当ファイル + 直近 diff を必ず添付 |
| 仮説 1 つだけ採用してすぐ修正 | AI に複数仮説を出させ、最小コスト検証から進める |
| ログに correlationId が無い | 構造化ログスキーマを `infrastructure/logger` で強制 |
| 再現テストなしで close | Red First を CI で強制（修正 PR は対応するテスト追加を必須） |

---

## 12. 関連ドキュメント

- [03. テスト](./03-testing.md)
- [05. パフォーマンス](./05-performance.md)
- [06. 領域横断の運用](./06-operations.md)
