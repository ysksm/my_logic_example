---
name: marimo
description: marimo ノートブックの開発パターンとよくあるエラーの対処法。marimo のセル設計、変数スコープ、UI コンポーネント、依存関係管理で使用する。
argument-hint: "[質問やタスクの説明]"
---

# marimo 開発ベストプラクティス

## セル間の依存関係

marimo はセル間の依存を **return された変数名** と **関数引数の変数名** で自動的に解決する。
依存が明示されていないセルは並列実行され、順序が保証されない。

### 依存を明示する

```python
# セル A: データを準備して変数を return
@app.cell
def _(conn):
    conn.execute("INSERT INTO ...")
    sync_completed = True
    return (sync_completed,)

# セル B: セル A の完了を待つ（sync_completed を引数に含める）
@app.cell
def _(conn, sync_completed):
    # sync_completed が存在する = セル A が完了している
    result = conn.execute("SELECT * FROM ...").fetchdf()
    return (result,)
```

### よくある間違い: return なしで依存が切れる

```python
# NG: return がないためセル B はセル A の完了を待たない
@app.cell
def _(conn):
    conn.execute("INSERT INTO ...")
    return  # ← 何も返していない

@app.cell
def _(conn):  # conn はスキーマセルから来るので、上のセルとは無関係に実行される
    conn.execute("SELECT * FROM ...")  # データがない！
```

## 変数スコープのルール

### セル間で同じ変数名は使えない

marimo ではセル間で同じ変数名を再定義するとエラーになる。
ループ変数も含まれる。

```python
# NG: 2つのセルで `s` を定義
# セル 1
for s in statuses:
    ...
# セル 2
for s in statuses_unique:  # エラー: 's' was also defined by cell-1
    ...

# OK: _ プレフィックスでプライベート変数にする
# セル 1
for _s in statuses:
    ...
# セル 2
for _s in statuses_unique:  # OK: _s はプライベート
    ...
```

### _ プレフィックスはプライベート

`_` で始まる変数はセル外に公開されず、他のセルと衝突しない。
一時変数やループ変数には必ず `_` を付ける。

**注意: DuckDB の `SELECT FROM` では `_` プレフィックス変数を参照できない**

```python
# NG: DuckDB は _df を見つけられない
_df = pd.DataFrame(...)
conn.execute("SELECT * FROM _df")  # Table _df does not exist!

# OK: _ なしの変数名を使う
temp_df = pd.DataFrame(...)
conn.execute("SELECT * FROM temp_df")
```

## nonlocal が使えない

marimo のセルはトップレベルスコープのため `nonlocal` は SyntaxError になる。
ミュータブルなコンテナで回避する。

```python
# NG
_counter = 0
def increment():
    nonlocal _counter  # SyntaxError: no binding for nonlocal '_counter' found
    _counter += 1

# OK: リストで回避
_counter = [0]
def increment():
    _counter[0] += 1
```

## return outside function

marimo のセルで条件分岐から `return` はできない。`mo.stop` を使う。

```python
# NG
if not data:
    mo.md("データがありません")
    return  # SyntaxError: 'return' outside function

# OK
mo.stop(not data, mo.md("データがありません"))
# ↓ data が truthy の場合のみ実行される
process(data)
```

## UI コンポーネント

### ドロップダウン

```python
project_selector = mo.ui.dropdown(
    options={"KEY": "KEY" for key in keys},
    label="プロジェクトを選択",
)
project_selector  # 最後の式がセルの出力になる
return (project_selector,)
```

### ボタン (run_button)

```python
sync_button = mo.ui.run_button(label="同期開始")
sync_button
return (sync_button,)
```

ボタンの値は押されると `True` になり、依存セルが再実行される。

```python
@app.cell
def _(sync_button, mo):
    mo.stop(not sync_button.value, mo.md("ボタンを押してください"))
    # ↓ ボタンが押された場合のみ実行
    do_sync()
```

### 複数ボタンの配置

```python
btn_a = mo.ui.run_button(label="A")
btn_b = mo.ui.run_button(label="B")
mo.hstack([btn_a, btn_b], gap=1)
return btn_a, btn_b
```

### 日付ピッカー

```python
date_picker = mo.ui.date(value="2026-01-01", label="日付を選択")
date_picker
return (date_picker,)
```

### テーブル表示

```python
mo.ui.table(df)  # インタラクティブなテーブル
```

### アコーディオン

```python
mo.accordion({
    "セクション1": mo.ui.table(df1),
    "セクション2": mo.ui.table(df2),
})
```

### レイアウト

```python
mo.vstack([element1, element2])  # 縦並び
mo.hstack([element1, element2])  # 横並び
mo.as_html(chart)                # Altair チャートの表示
```

## mo.stop でフロー制御

`mo.stop(condition, output)` は condition が truthy の場合にセルの実行を停止し、
下流の依存セルも全て停止する（「Ancestor stopped」）。

```python
mo.stop(not project_selector.value, mo.md("プロジェクトを選択してください"))
# ↑ 未選択なら停止。下流セルには「Ancestor stopped」が表示される

selected = project_selector.value  # ここ以降は選択済みの場合のみ実行
```

## セルの出力

セルの最後の式が出力（UI 表示）になる。
明示的に出力を変更するには `mo.output.replace()` を使う。

```python
@app.cell
def _(mo):
    mo.output.replace(mo.md("処理中..."))
    # ... 時間のかかる処理 ...
    mo.output.replace(mo.md("完了！"))
```

## Restart と再実行

- marimo edit モードでは **ファイルの外部変更は自動反映されない**
- Claude Code でファイルを編集した後は **Restart** が必要
- Restart はカーネルを再起動し、全セルの状態をリセットする
- Run All は全セルを依存順に再実行する

## マークダウンセル

```python
@app.cell
def _(mo):
    mo.md("""
    ## セクションタイトル
    """)
    return
```

`r` フラグ（raw string）と `f` フラグ（f-string）はマークダウンセルのツールバーで切り替え可能。

## altair チャートの表示

```python
import altair as alt

chart = (
    alt.Chart(df)
    .mark_bar()
    .encode(
        x=alt.X("count:Q", title="件数"),
        y=alt.Y("status:N", title="ステータス", sort="-x"),
    )
    .properties(title="タイトル", width=500, height=300)
)
mo.as_html(chart)
```

## よくあるエラーと対処

| エラー | 原因 | 対処 |
|--------|------|------|
| `SyntaxError: 'return' outside function` | セル内で条件付き return | `mo.stop()` を使う |
| `SyntaxError: no binding for nonlocal` | セルで nonlocal 使用 | リスト `[val]` で回避 |
| `This cell redefines variables from other cells` | セル間で変数名重複 | `_` プレフィックスを付ける |
| `Ancestor stopped` | 上流の `mo.stop` で停止 | 上流セルの条件を満たす（選択やボタン押下） |
| `This cell wasn't run because it has errors` | 構文エラーや変数衝突 | エラーメッセージを確認して修正 |
| データが空 / テーブルに0件 | 依存が切れていてセル実行順が不正 | 上流セルから変数を return し、下流の引数に追加 |
| `Notebook already connected` | 別タブで接続中 | 「Take over session」で切り替え |

## 未使用引数は自動削除される

marimo は**セル内で参照されていない引数を保存時に自動削除する**。
依存のためだけに引数を追加しても消えてしまう。

```python
# NG: expand_completed を引数に書いても、使っていないので保存時に消える
@app.cell
def _(conn, expand_completed, mo):
    result = conn.execute("SELECT ...").fetchdf()
    mo.ui.table(result)

# OK: mo.stop で参照すれば削除されない + 同期完了前のガードにもなる
@app.cell
def _(conn, expand_completed, mo):
    mo.stop(not expand_completed, mo.md(""))
    result = conn.execute("SELECT ...").fetchdf()
    mo.ui.table(result)
```

## 自動生成セルに注意

marimo edit モードで SQL を実行すると `mo.sql()` を使ったセルが自動追加される。
これらは依存関係が不正なことが多いので、不要なら削除する。

## セル設計の原則

1. **1セル1責務**: スキーマ作成、データ取得、データ加工、表示は別セルに
2. **依存は変数で明示**: 前のセルの完了を待つ必要がある場合、シグナル変数を return する
3. **副作用のあるセルは return する**: DB 書き込みなど副作用のあるセルは完了フラグを return
4. **ループ変数は `_` 付き**: `for _item in items:` で衝突を防ぐ
5. **エラーハンドリングは try/except**: `mo.stop` はフロー制御用、例外処理は try/except
