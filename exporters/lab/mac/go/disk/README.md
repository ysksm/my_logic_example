# lab/mac/go/disk — ディスク使用量 + I/O 取得 PoC

`gopsutil/v4/disk` で起動時に各パーティションの使用量を、その後 2 秒間隔で I/O カウンタの差分を出力します。

## 実行

```sh
cd lab/mac/go/disk
go run .
```

出力例（Apple Silicon / 2TB SSD）:

```
== Mounted partitions ==
  /                     fs=apfs      used=613.1GiB/1.8TiB ( 33.0%)
  /System/Volumes/Data  fs=apfs      used=613.1GiB/1.8TiB ( 33.0%)
  ...

== Disk I/O delta every 2s. Press Ctrl-C to stop. ==
[20:29:17]
  disk0         read=0B/s (    0 iops)  write=638.0KiB/s (  121 iops)
```

## 取得項目

- `disk.Partitions(false)` … `physical only=false` だと autofs 等の擬似 FS も列挙される。本コードでも全部出している（macOS では APFS のシステムボリューム多重マウントが見える）
- `disk.Usage(mountpoint)` … `Total / Used / UsedPercent` などの容量
- `disk.IOCounters()` … `ReadBytes / WriteBytes / ReadCount / WriteCount` 等の累積カウンタ。前回サンプルとの差分を秒単位に割ってバイト/秒、IOPS を算出

## メモ

- macOS では物理ディスクが `disk0`, `disk1`... として返る。APFS コンテナのスナップショット単位での内訳は取れない
- `Total` が `1.8TiB`（≒2TB のメーカ表記）と表示されるのは 1024 ベース換算による
- 起動直後は前回サンプルが無いので 1 周目の出力は `--`（このコードでは初回前にカウンタを取得して埋めているので最初から有効値）
