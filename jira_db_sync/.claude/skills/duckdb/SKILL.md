---
name: duckdb
description: DuckDB を使ったデータ管理のベストプラクティス。DuckDB のスキーマ設計、接続管理、データ同期、marimo 連携で使用する。
argument-hint: "[質問やタスクの説明]"
---

# DuckDB ベストプラクティス

## 接続管理

### 同一ファイルへの複数接続を避ける

DuckDB は同一ファイルに異なる設定での複数接続を許可しない。

```python
# NG: read_only と read_write が競合する
conn1 = duckdb.connect("data.duckdb")
conn2 = duckdb.connect("data.duckdb", read_only=True)  # Connection Error

# OK: 接続は1箇所で行い、変数として渡す
conn = duckdb.connect("data.duckdb")
```

### marimo での注意点

- marimo ではセル間で同じ DB ファイルに `duckdb.connect()` を複数回呼ばない
- DB 接続は1つのセルで行い、`conn` を他セルに渡す
- 同期状態のような軽量データは JSON ファイルで管理し、DB 接続の競合を避ける

## スキーマ設計

### テーブル作成

```sql
CREATE TABLE IF NOT EXISTS issues (
    id VARCHAR PRIMARY KEY,
    project_id VARCHAR NOT NULL,
    key VARCHAR NOT NULL,
    summary TEXT NOT NULL,
    status VARCHAR,
    raw_data JSON,
    synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### インデックス

```sql
CREATE INDEX IF NOT EXISTS idx_issues_key ON issues(key);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
```

### マイグレーション（カラム追加）

```python
# カラムの存在を確認してから追加
has_col = conn.execute(
    "SELECT COUNT(*) FROM information_schema.columns "
    "WHERE table_name = 'my_table' AND column_name = 'new_column'"
).fetchone()[0]
if has_col == 0:
    conn.execute("ALTER TABLE my_table ADD COLUMN new_column VARCHAR")
```

## データ操作

### UPSERT パターン

DuckDB には `INSERT OR REPLACE` があるが、バルクロードでは DELETE + INSERT が効率的。

```python
# 単一行: INSERT OR REPLACE
conn.execute(
    "INSERT OR REPLACE INTO projects (id, key, name) VALUES (?, ?, ?)",
    [id, key, name],
)

# バルクロード (DataFrame): DELETE + INSERT
conn.execute("DELETE FROM issues WHERE project_id = ?", [project_id])
conn.execute("INSERT INTO issues SELECT * FROM issues_df")
```

### 差分同期パターン

```python
# 取得した issue のみ差し替え（差分同期）
fetched_ids = issues_df["id"].tolist()
conn.execute(
    "DELETE FROM issues WHERE id IN (SELECT UNNEST(?))",
    [fetched_ids],
)
conn.execute("INSERT INTO issues SELECT *, CURRENT_TIMESTAMP FROM issues_df")
```

### DataFrame との連携

```python
# DataFrame → DuckDB (変数名で直接参照可能)
conn.execute("INSERT INTO my_table SELECT * FROM my_df")

# DuckDB → DataFrame
result_df = conn.execute("SELECT * FROM my_table").fetchdf()
```

### DEFAULT カラムがある場合

テーブルに DEFAULT 付きカラム（例: `synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`）がある場合、
`SELECT *` で DataFrame を INSERT するとカラム数が合わない。

```python
# NG: issues テーブルが 21 カラムだが issues_df は 20 カラム
conn.execute("INSERT INTO issues SELECT * FROM issues_df")

# OK: DEFAULT カラムの値を明示的に追加
conn.execute("INSERT INTO issues SELECT *, CURRENT_TIMESTAMP FROM issues_df")
```

## marimo 固有の注意点

### 変数名の衝突

marimo ではセル間で同じ変数名を定義できない。ループ変数もスコープに含まれる。

```python
# NG: 別のセルで `s` や `issue` を使うとエラー
for s in statuses:
    ...

# OK: _ プレフィックスでプライベート変数にする
for _s in statuses:
    ...
```

### nonlocal が使えない

marimo のセルはトップレベルスコープのため `nonlocal` が使えない。ミュータブルなコンテナで回避する。

```python
# NG
_counter = 0
def increment():
    nonlocal _counter  # SyntaxError
    _counter += 1

# OK
_counter = [0]
def increment():
    _counter[0] += 1
```

### mo.stop で条件付き実行

```python
mo.stop(not project_selector.value, mo.md("プロジェクトを選択してください"))
# project_selector.value が falsy ならここで停止し、下流セルも実行されない
```

## テーブル情報の確認

```sql
-- テーブル一覧と件数
SELECT table_name, estimated_size FROM duckdb_tables() ORDER BY table_name;

-- カラム一覧
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'issues' ORDER BY ordinal_position;

-- シーケンス
CREATE SEQUENCE IF NOT EXISTS my_seq START 1;
SELECT nextval('my_seq');
```

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|--------|------|------|
| `Connection Error: Can't open a connection to same database file with a different configuration` | 同一ファイルに複数接続 | 接続を1箇所にまとめる |
| `Binder Error: table has N columns but M values were supplied` | INSERT のカラム数不一致 | DEFAULT カラム分の値を明示的に追加 |
| `Catalog Error: Table does not exist` | テーブル未作成 | `CREATE TABLE IF NOT EXISTS` を使う |
| `Constraint Error: Duplicate key` | PRIMARY KEY 重複 | `INSERT OR REPLACE` または事前に DELETE |
