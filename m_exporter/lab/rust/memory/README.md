# lab/rust/memory — メモリ使用量取得 PoC（Rust）

`sysinfo` クレートで物理メモリと swap の使用状況を 1 秒間隔で出力します。
Go 版（`lab/go/memory/`）の Rust 移植です。

## 実行

```sh
cd lab/rust/memory
cargo run --release
```

出力例:

```
Total memory: 128.0GiB
Sampling every 1s. Press Ctrl-C to stop.
[20:32:26] used=43.9GiB/128.0GiB ( 34.3%)  available=90.8GiB  free=50.5GiB  swap=0B/0B (  0.0%)  swap_free=0B
```

## 取得項目

| メソッド                    | 内容                                          |
| --------------------------- | --------------------------------------------- |
| `sys.total_memory()`        | 物理メモリ総量（バイト）                      |
| `sys.used_memory()`         | 使用中（バイト）                              |
| `sys.available_memory()`    | アプリが追加で確保できる見込み量              |
| `sys.free_memory()`         | OS の純粋な空き                               |
| `sys.total_swap()` 等       | swap の total / used / free                   |

## Go 版との差分メモ

- `sysinfo` には Go 側で取れた `Active / Inactive / Wired` が **無い**
- macOS 固有のメモリ内訳（圧縮メモリ等）が必要なら、`mach2` クレートで `host_statistics64` の `vm_statistics64` を直接呼ぶか、`vm_stat(1)` をパースする実装が必要
- sysinfo 0.32 系から **戻り値の単位がバイト** で揃っている（古い版では KB を返していた）
