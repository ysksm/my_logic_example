# lab/rust/load — ロードアベレージ + ホスト情報 PoC（Rust）

`sysinfo` でホスト情報を表示し、2 秒間隔で load average と総プロセス数を出力します。
Go 版（`lab/go/load/`）の Rust 移植です。

## 実行

```sh
cd lab/rust/load
cargo run --release
```

出力例:

```
== Host info ==
  hostname=MacBook.local  os=Darwin  os_version=26.4.1  kernel=25.4.0
  uptime=7d15h25m43s  boot_time=2026-04-18T18:36:06+09:00

== Load average + process count every 2s. Press Ctrl-C to stop. ==
[10:01:49] load1= 1.66  load5= 1.57  load15= 1.55  procs_total=923
```

## 取得項目

- `System::host_name() / name() / os_version() / kernel_version()` — ホスト情報（`Option<String>`）
- `System::uptime() / boot_time()` — それぞれ秒数 / Unix epoch
- `System::load_average()` — `LoadAvg { one, five, fifteen }`
- `sys.refresh_processes(...)` → `sys.processes().len()` — プロセス総数
  （gopsutil の `load.Misc().ProcsTotal` が macOS で 0 になる問題を、ここでは process 列挙で代替）

## Go 版との差分メモ

- gopsutil の `host.Info()` には `procs_running / procs_blocked` が出るが、sysinfo にはランニング状態の集計 API が無い
- 一方で sysinfo は **macOS でも `procs_total` が取れる**（毎回 process スナップショットを撮るためコストはやや高い）
- コンテキストスイッチ数は両方とも取れない（macOS では `host_statistics` を直接叩く必要あり）
