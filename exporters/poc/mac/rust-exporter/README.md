# poc/mac/rust-exporter — macOS 向け Prometheus exporter PoC（Rust）

`lab/mac/rust/cpu` と `lab/mac/rust/memory` の取得ロジックを Prometheus exporter にまとめた PoC です。
Go 版（`poc/mac/go-exporter`）と同じメトリクス名で出力します。

## 構成

- `axum 0.7` + `tokio` で HTTP サーバ
- `prometheus-client 0.22`（公式 Rust クライアント、OpenMetrics 準拠）
- `sysinfo 0.32` で計測
- `serde` + `toml` で設定ファイル読み込み、`humantime-serde` で `interval` を文字列指定可能に
- `clap` でコマンドライン引数

## 設定ファイル

`config.toml`:

```toml
[server]
listen_addr  = "0.0.0.0:9101"
metrics_path = "/metrics"

[collector]
interval = "5s"
```

| キー                    | 既定値          | 内容                                                |
| ----------------------- | --------------- | --------------------------------------------------- |
| `server.listen_addr`    | `0.0.0.0:9101`  | バインドアドレス（Go 版とポート分離）              |
| `server.metrics_path`   | `/metrics`      | エンドポイント                                      |
| `collector.interval`    | `5s`            | バックグラウンド収集の周期（humantime 形式の文字列）|
| `collector.unit`        | `ratio`         | `"ratio"` (0-1) または `"percent"` (0-100)。後者ではメトリクス名末尾も `_percent` になる |

## 実行

```sh
cd poc/mac/rust-exporter
cargo run --release -- --config config.toml
# 別ターミナル
curl -s http://127.0.0.1:9101/metrics | grep ^mac_exporter_
```

## 公開メトリクス

Go 版とメトリクス名・ラベル・型を揃えています:

- `mac_exporter_cpu_usage_{ratio,percent}{cpu="0|1|...|total"}`
- `mac_exporter_memory_{total,used,available}_bytes`
- `mac_exporter_memory_used_{ratio,percent}`
- `mac_exporter_swap_{total,used}_bytes`、`mac_exporter_swap_used_{ratio,percent}`
- `mac_exporter_collector_last_success_timestamp_seconds`

`*_ratio` / `*_percent` の選択は `collector.unit` で切り替え（既定 `ratio`）。

**Go 版との差分**:
- `mac_exporter_collector_errors_total` は **Rust 版では出していない**。`sysinfo` は refresh 系 API がエラーを返さないため、立てるだけ無意味な metric になるので除外
- HELP 行末尾の `.` は `prometheus-client` が自動付与するので、コード側では付けない

## 設計メモ

- **収集モデル**: tokio タスクが `interval` 周期で `sys.refresh_cpu_all()` + `sys.refresh_memory()` を呼び、
  `Family<Labels, Gauge<f64, AtomicU64>>` を `set()` で更新。`/metrics` ハンドラは
  `prometheus_client::encoding::text::encode(&registry)` を返すだけ
- **CPU 差分**: `sysinfo` は 2 回連続で `refresh_cpu_all()` を呼ぶ必要があるので、起動時に 1 回シード + `MINIMUM_CPU_UPDATE_INTERVAL` (200ms) 待ち
- **メトリクス所有**: `Family` / `Gauge` は内部 `Arc` でクローンが安価。`Registry` 用と collector 用の 2 箇所にクローンを置き、
  どちらから更新しても同じアトミックを叩く構成
- **シャットダウン**: `axum::serve(...).with_graceful_shutdown(ctrl_c)` で HTTP を畳み、その後 collector タスクを `abort()`
