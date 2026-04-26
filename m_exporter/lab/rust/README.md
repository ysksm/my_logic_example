# lab/rust — macOS パフォーマンスデータ取得 PoC（Rust 版）

Go 版（`lab/go/`）と同じことを Rust でも試し、ライブラリの取り回しを比較するための作業ディレクトリです。

## 採用ライブラリ

- [`sysinfo`](https://crates.io/crates/sysinfo) — クロスプラットフォーム system info ライブラリ。Go の `gopsutil` と立ち位置が近い
- [`ctrlc`](https://crates.io/crates/ctrlc) — SIGINT ハンドラ。std だけだと面倒なので採用
- [`chrono`](https://crates.io/crates/chrono) — タイムスタンプ整形（`clock` 機能のみ）

## ビルド & 実行

各サブクレートで:

```sh
cd lab/rust/cpu       # または memory
cargo run --release
```

## Go 版との比較メモ

| 項目                | Go (gopsutil)                                        | Rust (sysinfo)                              |
| ------------------- | ---------------------------------------------------- | ------------------------------------------- |
| API 形態            | パッケージ単位の関数（`cpu.Percent` など）           | `System` インスタンスに対して `refresh_*`   |
| サンプル取り方       | 内部で前回値を保持、`Percent(0, ...)` が差分を返す  | `refresh_cpu_all()` を 2 回 + 規定の wait   |
| メモリの粒度         | `Active / Inactive / Wired` まで取れる              | `total / used / available / free` のみ      |
| バイナリサイズ       | 静的リンクで ~10MB                                  | release ビルドで ~1MB 強                     |
| 初回サンプル         | 1 周目から有効                                       | `MINIMUM_CPU_UPDATE_INTERVAL` 待つ必要あり  |

メモリ系で macOS 固有の Active/Inactive/Wired/Compressed を取りたい場合、`sysinfo` だけでは足りないので
`mach2` クレートで `host_statistics64` を直接叩くなどの追加実装が必要。
