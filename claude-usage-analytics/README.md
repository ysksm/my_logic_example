# Claude Code 利用状況アナリティクス

ローカルの Claude Code セッション履歴（`~/.claude/projects/**/*.jsonl`）を
**DuckDB** に取り込み、**marimo** で探索的に分析・可視化するツールです。
「まず課題を見つける」ための柔軟な分析環境を目的にしています。

> ⚠️ 注意: このツールは **あなたのローカルマシン** で動かしてください。
> クラウド/CIのコンテナには自分の履歴は無く、そのセッション分しか取得できません。

## セットアップ & 実行

[uv](https://docs.astral.sh/uv/) が必要です。

```bash
cd claude-usage-analytics

# 1. JSONL履歴を DuckDB に変換（既定で ~/.claude を読む）
uv run python build_db.py
#   → claude_usage.duckdb を生成

# 2. ダッシュボードを開く（探索モード：セルを自由に追加できる）
uv run marimo edit app.py

#   閲覧専用で開きたい場合
uv run marimo run app.py
```

別の場所の履歴や配置を指定する場合:

```bash
uv run python build_db.py --source /path/to/.claude --out my.duckdb
```

## 取り込まれるデータ

`build_db.py` が3つのテーブル + 1ビューを作ります。

| テーブル | 粒度 | 主なカラム |
|---|---|---|
| `events` | JSONLの1行 | `type`, `session_id`, `project`, `timestamp`, `model`, `input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_creation_tokens`, `cost_usd`, `text_len`, `thinking_len`, `is_subagent` |
| `tool_calls` | ツール呼び出し1回 | `tool_name`, `call_ts`, `result_ts`, `duration_ms`(wall-clock実行時間), `is_error`, `input_json`, `result_chars`, `tool_use_result` |
| `prompts` | 人間の発話1回 | `timestamp`, `project`, `char_len`, `word_len`, `text` |
| `sessions` (view) | セッション | 開始/終了/長さ・ターン数・トークン・コスト集計 |

## ダッシュボードの分析軸

期間・プロジェクト・モデルのフィルタに全グラフが連動します。

- **コスト/トークン**: 日次コスト、モデル別コスト、トークン種別の内訳（キャッシュ効率）
- **ツール利用**: ツール別呼び出し回数・エラー率、実行時間（中央値/p95）
- **セッション/生産性**: 日次セッション数、セッション長×ターン数、時間帯別活動
- **プロジェクト横断**: プロジェクト別サマリ表、日次コスト推移
- **エラー**: ツール別エラー件数、失敗呼び出しの一覧
- **内容**: プロンプト長の分布、長いプロンプト Top20

## カスタマイズ

- **料金**: `pricing.py` の `PRICING`（USD / 100万トークン）を実際の契約に合わせて編集。
  未知のモデルはコスト0として扱われます。
- **集計の追加**: `uv run marimo edit app.py` で SQL/Python セルを追加し、
  `ev` / `tc` / `pr`（フィルタ済みDataFrame）を使って自由に分析できます。

## データの扱い

`tool_calls.tool_use_result` や `prompts.text` には、コマンド出力やプロンプト本文など
**機微な情報が含まれ得ます**。生成される `.duckdb` は `.gitignore` 済みでコミットされません。
