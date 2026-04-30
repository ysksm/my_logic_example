# lab/mac/go/load — ロードアベレージ + ホスト情報 PoC

`gopsutil/v4/load` と `gopsutil/v4/host` を使って、起動時にホスト情報を、その後 2 秒間隔で load average と関連カウンタを出力します。

## 実行

```sh
cd lab/mac/go/load
go run .
```

出力例:

```
== Host info ==
  hostname=MacBook.local  os=darwin  platform=darwin 26.4.1  kernel=25.4.0  arch=arm64
  uptime=169h53m48s  boot_time=2026-04-18T18:36:06+09:00

== Load average + misc counters every 2s. Press Ctrl-C to stop. ==
[20:29:56] load1= 0.71  load5= 1.07  load15= 1.56  procs_running=3  procs_blocked=0  procs_total=0  ctx_switches=0
```

## 取得項目

- `host.Info()` … hostname / os / platform / kernel / arch / uptime / boot_time
- `load.Avg()` … 1分 / 5分 / 15分 ロードアベレージ
- `load.Misc()` … `ProcsRunning / ProcsBlocked / ProcsTotal / Ctxt`（コンテキストスイッチ数）

## メモ

- macOS では `load.Misc` のうち `ProcsTotal` と `Ctxt` は **常に 0** が返る（gopsutil 側の実装が Linux `/proc/stat` 前提のため）。
  本気で取りたければ `host_processor_info()` や `sysctl kern.proc` を直接叩く必要がある
- `ProcsRunning / ProcsBlocked` は macOS でも値が入る
- `host.Info()` の `Uptime` は秒単位の `uint64`
