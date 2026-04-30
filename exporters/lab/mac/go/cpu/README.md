# lab/mac/go — CPU 使用率取得 PoC

macOS のパフォーマンスデータ収集ツール（最終的に Grafana / Prometheus exporter 化を想定）の技術調査用コードです。
まずは CPU 使用率を 1 秒間隔で取得しコンソールに出力するだけの最小実装です。

## 目的

- `gopsutil` で macOS の CPU メトリクスを取得できることを確認する
- サンプリング間隔・per-core 取得・シグナル処理など、後続の exporter 実装で再利用できる骨格を確立する

## 使用ライブラリ

- [`github.com/shirou/gopsutil/v4/cpu`](https://pkg.go.dev/github.com/shirou/gopsutil/v4/cpu)
  - クロスプラットフォームで CPU / メモリ / ディスク / プロセス情報が取れる定番ライブラリ
  - macOS 上では内部的に `host_statistics` / `sysctl` 等を呼び出している

## 実行

```sh
cd lab/mac/go
go run .
```

出力例（Apple Silicon / 16 論理コア）:

```
CPU cores: physical=16 logical=16
Sampling every 1s. Press Ctrl-C to stop.
[20:04:41] total=  5.3%  cpu0= 21.5%  cpu1= 18.8% ...  cpu15=  0.9%
[20:04:42] total= 10.3%  cpu0= 41.4%  cpu1= 36.0% ...  cpu15=  3.0%
```

`Ctrl-C` で停止します。

## 仕様メモ

- `cpu.Counts(true)` … 論理コア数 / `cpu.Counts(false)` … 物理コア数
- `cpu.PercentWithContext(ctx, 0, false)` … 全コア合算の使用率（直近サンプル間の差分から算出）
- `cpu.PercentWithContext(ctx, 0, true)` … per-core の使用率
- `interval=0` を渡すと「前回呼び出し時点との差分」を返す。初回呼び出しは無効値になり得るので注意
  （本コードでは ticker と組み合わせて毎秒の差分として利用）

## 次の調査候補

- メモリ (`mem.VirtualMemory`)、ディスク I/O (`disk.IOCounters`)、ネットワーク (`net.IOCounters`)、ロードアベレージ (`load.Avg`)
- macOS 固有の指標（`powermetrics` 由来の電力 / 温度、`top` 由来のコンテキストスイッチ等）が gopsutil で取れない場合は CLI 呼び出しでの取得を検討
- Prometheus exporter 化（`promhttp` + `Collector` 実装）
