# lab/rust — macOS パフォーマンスデータ取得 PoC（Rust 版）

Go 版（`lab/go/`）と同じことを Rust でも試し、ライブラリの取り回しを比較するための作業ディレクトリです。

## 採用ライブラリ

- [`sysinfo`](https://crates.io/crates/sysinfo) — クロスプラットフォーム system info ライブラリ。Go の `gopsutil` と立ち位置が近い
- [`ctrlc`](https://crates.io/crates/ctrlc) — SIGINT ハンドラ。std だけだと面倒なので採用
- [`chrono`](https://crates.io/crates/chrono) — タイムスタンプ整形（`clock` 機能のみ）

## サブクレート

| ディレクトリ | 内容                                                |
| ------------ | --------------------------------------------------- |
| `cpu/`       | total / per-core CPU 使用率                         |
| `memory/`    | 物理メモリ + swap の使用量                          |
| `disk/`      | マウント済みディスクの容量（**I/O カウンタは無し**）|
| `network/`   | per-interface の I/O 差分（bps）                    |
| `load/`      | ホスト情報 + load average + プロセス総数            |

## ビルド & 実行

各サブクレートで:

```sh
cd lab/rust/<name>     # cpu / memory / disk / network / load
cargo run --release
```

## Go 版との比較メモ

| 項目                | Go (gopsutil)                                        | Rust (sysinfo)                              |
| ------------------- | ---------------------------------------------------- | ------------------------------------------- |
| API 形態            | パッケージ単位の関数（`cpu.Percent` など）           | `System` / `Disks` / `Networks` に対して `refresh_*` |
| CPU サンプル        | 内部で前回値保持、`Percent(0, ...)` が差分           | `refresh_cpu_all()` を 2 回 + 規定の wait   |
| メモリ粒度          | `Active / Inactive / Wired` まで取れる               | `total / used / available / free` のみ      |
| ディスク I/O        | `disk.IOCounters` で取れる                           | **取れない**（usage のみ）                  |
| ディスク種別         | 取れない                                             | `Disk.kind()` で SSD/HDD                    |
| ネットワーク差分     | 累積カウンタを自分で diff                           | `refresh()` 単位の delta が直接返る         |
| プロセス総数         | macOS では `load.Misc().ProcsTotal=0` で取れない    | `sys.processes().len()` で取れる            |
| バイナリサイズ       | 静的リンクで ~10MB                                  | release ビルドで ~1MB 強                     |

macOS 固有指標（メモリの Active/Inactive/Wired/Compressed、ディスク I/O カウンタ、コンテキストスイッチ等）を取りたい場合、
両ライブラリとも素では届かないため、`mach2` クレートで `host_statistics64` を直叩きするか、
`vm_stat` / `iostat` の出力をパースする実装が必要になる。
