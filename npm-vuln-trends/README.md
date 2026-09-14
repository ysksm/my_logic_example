# npm-vuln-trends — npm ライブラリの不具合・脆弱性の時系列集計

公式情報を収集し、**内容別の変化**を時系列で追うためのツール。
[設計提案スライド](https://ysksm.github.io/slides/npm-vulnerability-trends/index.html) を実装したもの。

脆弱性と通常の不具合を**別々に**集計し、原本から集計結果まで再現できるようにする。

| 対象 | 主な情報源 | 数える単位 |
|---|---|---|
| 公開脆弱性 | GitHub Advisory Database（GitHub-reviewed を主系列） | 重複解決後の advisory |
| 通常の不具合 | 各ライブラリの公式 Issue | バグに該当する Issue |
| 自システムへの影響 | npm audit | 診断対象・実行時点ごとの結果 |

公開報告数と、現在使っている依存関係の検出数は**別指標**なので合算しない。

## 使い方

```bash
bun install

# 説明用の架空データで、正規化〜集計〜可視化を一通り確認する
bun run demo
bun run serve            # http://localhost:8787/

# 実データを収集する（GITHUB_TOKEN 推奨）
export GITHUB_TOKEN=ghp_xxx
bun run collect                       # advisories + osv + issues
bun run collect -- --source issues    # 情報源を絞る

# 集計して静的 HTML / SVG / CSV を出力する
bun run report -- --from 2026-01 --to 2026-06
bun run report -- --packages-only     # 監視対象パッケージのみ

# その時点までに収集した版を再現する（観測時点の再集計）
bun run report -- --as-of 2026-03-01T00:00:00Z

# npm audit の結果を取り込む
npm audit --json > audit.json
bun run src/index.ts audit-import --file audit.json --target my-project
```

`bun run src/index.ts help` で全オプションを表示する。

## パイプライン

```
公式情報 → 原本保存 → 正規化・履歴 → 月次集計 → 静的 HTML/SVG/CSV
```

原本には URL・取得日時・内容ハッシュ・実行 ID を付けて保存する。
対象台帳（`config/registry.json`）と分類（`config/taxonomy.json`）にも版を付け、
どの版で集計したかを出力に記録する。

小規模構成：日次バッチ + SQLite + 静的 HTML/SVG。外部サービスに依存しない。

## 数え方の決め事

実装は次の不変条件を満たす（`test/aggregate.test.ts` で検証している）。

- **主分類の合計 = 全体件数。** 1 advisory は 1 主分類にだけ計上する。
  複数 CWE がある場合は priority の高いカテゴリを採り、全 CWE は明細に残す。
- **再取得しても増えない。** ID と内容ハッシュで一意化する。
- **更新では新規が増えない。** 新規件数は `published_at`（公開月）で数え、
  `modified_at` の更新は件数に影響しない。
- **複数パッケージでも全体件数は 1。** パッケージ別では各 1 として数えるため、
  パッケージ別の合計は全体件数と一致しない（別軸として表示する）。
- **GitHub と OSV の同じ報告は 1 件。** 明示 alias（GHSA / CVE）でのみ照合し、
  `related` は同一性の根拠にしない。
- **撤回は新規件数に加算しない。** 撤回された件数は品質パネルに出す。
- **PR は不具合件数に数えない。** `state=all` で取り込んだうえで除外する。
- **bug 判定は集計時に行う。** 取得時にラベルで絞らないため、ラベル削除も反映される。
- **close ≠ 修正。** `reported` / `confirmed` / `duplicate` / `invalid` を区別し、
  `not_planned` のクローズは修正として数えない。
- **月境界は UTC。**

### 時刻の使い分け

| 時刻 | 用途 |
|---|---|
| `published_at` | 公開月の新規件数。混入日・発見日とは異なる |
| `modified_at` / `withdrawn_at` | 更新・撤回の追跡。新規件数には加算しない |
| `first_seen_at`（observed_at） | その時点までに収集した版を再現する |

既定は「現在の知識で過去を再集計する」表示。`--as-of` を付けると
「保存済みの観測時点」の表示に切り替わる。収集開始前の状態は履歴がないため再現できない。

### 差分取得

差分は公開日ではなく `modified`（変更）を起点に追う。

- 初回は全ページ取得。以降は前回カーソルから **48 時間の重複窓**を差し引いた地点から再取得する
  （`NVT_OVERLAP_HOURS` で変更可）。
- **全ページ成功後にだけ**カーソルを更新する。失敗時は前回の位置を維持し、次回取り直す。
- 取得できなかった情報源は `coverage` に `missing` として残し、**0 件と区別する**。

## 内容別カテゴリ

CWE から表示用のカテゴリへ対応させる（`config/taxonomy.json`、版付き）。
重大度は内容分類とは独立した軸として保持する。

| 内容 | CWE の例 |
|---|---|
| コマンド・コード実行 | 78・94・77・88・502 |
| XSS | 79・80・83 |
| パストラバーサル | 22・23・36・59 |
| Prototype Pollution | 1321・915 |
| ReDoS・リソース枯渇 | 1333・400・770・405・674・834・409 |
| SSRF | 918 |
| 認証・認可 | 287・862・863・285・306 |
| その他 | 対応表に無い CWE |
| 未分類 | CWE が欠損 |

「その他」（対応表の未整備）と「未分類」（情報の欠損）は分けて数える。
どちらも品質パネルで率として監視する。

## 監視対象の台帳

`config/registry.json` に package 名・公式 repository・bugs URL・対象期間を記録する。
バグ判定ラベルは、プロジェクトごとの運用に合わせて上書きできる。

```json
{
  "name": "webpack",
  "repository": "webpack/webpack",
  "bugs_url": "https://github.com/webpack/webpack/issues",
  "since": "2026-01-01",
  "until": null,
  "bug_labels": ["bug"]
}
```

対象を追加すると件数も増えるため、件数の増加だけで品質の悪化とは判断しない。

## 出力

`dist/` に静的ファイルを出力する。サーバ処理は不要。

| ファイル | 内容 |
|---|---|
| `index.html` | 積み上げ棒・ヒートマップ・折れ線・明細・品質パネル（SVG はインライン） |
| `category.csv` | 月次 × 内容別（合計列 = 全体件数） |
| `severity.csv` | 月次 × 重大度 |
| `package.csv` | パッケージ別 |
| `issues.csv` | 不具合（状態別・月末未解決） |
| `detail.csv` | 明細（ID・CWE・影響範囲・原典リンク） |
| `summary.json` | 集計結果そのもの |

画面には対象範囲・取得基準日時・分類版・数値表・CSV を併記する。

## 構成

```
src/
  index.ts            CLI（collect / aggregate / report / demo / serve / audit-import）
  config.ts           設定・台帳・分類の読み込み
  db/
    schema.sql        原本・正規化・履歴・収集可否・版のスキーマ
    index.ts          upsert と実行履歴・カーソル
  domain/
    types.ts          ドメイン型
    taxonomy.ts       CWE → 内容別カテゴリ
    dedup.ts          alias による統合（水増し防止）
    issueState.ts     bug 判定と reported/confirmed/duplicate/invalid
    time.ts           UTC 月境界・重複窓
  collect/
    http.ts           レート制限・再試行・Link ヘッダ
    advisories.ts     GitHub Global Advisories
    osv.ts            OSV（alias・影響範囲の照合）
    issues.ts         GitHub Issues
    audit.ts          npm audit --json の取り込み
  aggregate/monthly.ts  月次集計と品質指標
  report/
    svg.ts            積み上げ棒・ヒートマップ・折れ線
    html.ts           静的 HTML
    csv.ts            CSV 出力
  demo/fixtures.ts    説明用の架空データ
```

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | — | GitHub API のトークン。未設定だとレート制限で失敗しやすい |
| `NVT_DB` | `data/npm-vuln-trends.sqlite` | SQLite の保存先 |
| `NVT_OUT` | `dist` | 出力先 |
| `NVT_REGISTRY` / `NVT_TAXONOMY` | `config/*.json` | 台帳・分類の位置 |
| `NVT_OVERLAP_HOURS` | `48` | 差分取得の重複窓 |

## テスト

```bash
bun test          # 60 件
bun run typecheck
```

統合・分類・集計の不変条件、差分取得の起点、原本の一意化、
HTML / SVG / CSV の生成を検証する。

## 注意

`bun run demo` が出すのは**説明用の架空データ**であり、npm の実測値ではない。
スライドと同じ内訳（XSS 3/5/2・資源枯渇 2/3/2・未分類 1/1/1）を再現するように作ってある。

## 情報源

[GitHub Global Advisories API](https://docs.github.com/en/rest/security-advisories/global-advisories) ·
[GitHub Advisory Database](https://github.com/advisories) ·
[OSV](https://osv.dev/) ·
[GitHub Issues API](https://docs.github.com/en/rest/issues/issues) ·
[npm audit](https://docs.npmjs.com/cli/commands/npm-audit) ·
[MITRE CWE](https://cwe.mitre.org/)
