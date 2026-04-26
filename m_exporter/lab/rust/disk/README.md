# lab/rust/disk — ディスク使用量 PoC（Rust）

`sysinfo` クレートで起動時にマウント済みディスク一覧を表示し、2 秒間隔で容量を再取得します。
Go 版（`lab/go/disk/`）の Rust 移植ですが、**I/O カウンタは取得しません**（後述）。

## 実行

```sh
cd lab/rust/disk
cargo run --release
```

出力例:

```
== Mounted disks ==
  /                       fs=apfs      used=602.6GiB/1.8TiB ( 32.4%)  kind=SSD
  /System/Volumes/Data    fs=apfs      used=602.6GiB/1.8TiB ( 32.4%)  kind=SSD

== Refreshing disk usage every 2s. Press Ctrl-C to stop. ==
[10:01:48]
  /                       used=602.6GiB/1.8TiB ( 32.4%)  free=1.2TiB
```

## Go 版との差分メモ

| 項目                         | Go (gopsutil)                              | Rust (sysinfo)                       |
| ---------------------------- | ------------------------------------------ | ------------------------------------ |
| パーティション一覧            | `disk.Partitions(false)` で擬似 FS も含む | `Disks::new_with_refreshed_list()` は実マウントのみで gopsutil より絞られる |
| 容量取得                      | `disk.Usage(mountpoint)`                   | `Disk.total_space() / available_space()` |
| 物理ディスクの I/O カウンタ   | `disk.IOCounters()` で取れる              | **取れない**（プロセス単位の I/O のみ）|
| ディスク種別 (SSD/HDD)        | 取れない                                   | `Disk.kind()` で取れる               |

per-disk の I/O 帯域 / IOPS が必要なら、Rust では `iostat -d` の出力をパースするか、
`io_kit_sys` クレート等で IOKit を直接叩く実装が必要。
