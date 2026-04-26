# poc/go-exporter — Prometheus exporter PoC（Go）

`lab/go/cpu` と `lab/go/memory` の取得ロジックを Prometheus exporter にまとめた PoC です。
バックグラウンドで一定間隔に収集し、`/metrics` ではキャッシュされた最新値を返します。

## 構成

- `net/http`（標準）+ `github.com/prometheus/client_golang/prometheus` + `promhttp`
- `github.com/shirou/gopsutil/v4/{cpu,mem}` で計測
- `github.com/BurntSushi/toml` で設定ファイル読み込み

## 設定ファイル

`config.toml`:

```toml
[server]
listen_addr  = "0.0.0.0:9100"
metrics_path = "/metrics"

[collector]
interval = "5s"
```

| キー                    | 既定値          | 内容                                 |
| ----------------------- | --------------- | ------------------------------------ |
| `server.listen_addr`    | `0.0.0.0:9100`  | バインドアドレス                     |
| `server.metrics_path`   | `/metrics`      | エンドポイント                       |
| `collector.interval`    | `5s`            | バックグラウンド収集の周期（time.Duration 形式）|

## 実行

```sh
cd poc/go-exporter
go run . --config config.toml
# 別ターミナルで
curl -s http://127.0.0.1:9100/metrics | grep ^m_exporter_
```

## 公開メトリクス

| メトリクス名                                              | 型      | ラベル | 内容                                  |
| --------------------------------------------------------- | ------- | ------ | ------------------------------------- |
| `m_exporter_cpu_usage_ratio`                              | Gauge   | `cpu`  | per-core 使用率 (0-1)、`cpu="total"` も |
| `m_exporter_memory_total_bytes`                           | Gauge   | -      | 物理メモリ総量                        |
| `m_exporter_memory_used_bytes`                            | Gauge   | -      | 使用中                                |
| `m_exporter_memory_available_bytes`                       | Gauge   | -      | 追加確保可能量                        |
| `m_exporter_memory_used_ratio`                            | Gauge   | -      | 使用率 (0-1)                          |
| `m_exporter_swap_total_bytes`                             | Gauge   | -      | swap 総量                             |
| `m_exporter_swap_used_bytes`                              | Gauge   | -      | swap 使用                             |
| `m_exporter_swap_used_ratio`                              | Gauge   | -      | swap 使用率 (0-1)                     |
| `m_exporter_collector_last_success_timestamp_seconds`     | Gauge   | -      | 最後に収集が成功した時刻（unix 秒） |
| `m_exporter_collector_errors_total`                       | Counter | `source` | 収集エラー数（`cpu` / `memory` / `swap`）|

## 設計メモ

- **収集モデル**: バックグラウンド goroutine が `interval` 周期で取得 → グローバルな `GaugeVec`/`Gauge` を `Set` する。`/metrics` ハンドラは集計済みレジストリをエンコードするだけ
- **CPU の差分**: `cpu.Percent(0, true)` は「前回呼び出しからの差分」を返すので、起動直後にシード呼び出しを 1 回入れて、初回 tick からまともな値が出るようにしている
- **命名規則**: 値は **比率 (0-1)** で出している（Prometheus 慣習。`*_percent` ではなく `*_ratio`）
- **ラベル設計**: per-CPU は `cpu="0|1|...|total"`。今回は CPU/メモリのみだが、後で disk/network を追加する際は `device` / `interface` ラベルを追加予定
