# mini-prometheus — Prometheus 相当の最小実装 PoC

`poc/go-exporter` (`:9100`) / `poc/rust-exporter` (`:9101`) を **観測する側** の最小再実装。
Prometheus 本体に相当する scrape ループ + 時系列ストレージ + PromQL + HTTP API を、
Go と Rust の二実装で揃えた。

## ディレクトリ

| ディレクトリ | 内容                                             | 既定ポート |
| ------------ | ------------------------------------------------ | ---------- |
| `go/`        | Go 実装。`net/http` + `BurntSushi/toml` のみ     | `9092`     |
| `rust/`      | Rust 実装。`axum` + `tokio` + `reqwest`          | `9093`     |

両者は **同じ TOML スキーマ・同じ PromQL サブセット・同じ HTTP API JSON 形式** を返すので、
Grafana の Prometheus データソースから URL を切り替えるだけで参照先を入れ替えられる。

## スコープ

- **scrape**: TOML の `[[scrape_configs]]` を `scrape_interval` 周期で HTTP `GET`
- **parser**: Prometheus text exposition format（`HELP`, `TYPE`, `metric{l="v"} value [ts_ms]`）
- **storage**: メモリ上の `seriesID -> ring buffer((t_ms, v))`、`label=value -> seriesID` の posting index
- **永続化**: `data_dir/snapshot.json` への定期スナップショット + 終了時最終保存 + 起動時自動復元（言語間でフォーマットは互換ではない）
- **UI**: `/` に target health 一覧、`/graph` に PromQL 入力欄 + Canvas ベースの折れ線グラフ（外部依存なし）
- **PromQL**: ベクタセレクタ / 範囲セレクタ / 二項演算 / 集約 (`sum/avg/max/min/count by|without`) /
  `rate, irate, increase, delta, *_over_time, time, vector, scalar, abs, clamp_*`、`offset`
- **API**: `/api/v1/query`, `/query_range`, `/labels`, `/label/<n>/values`, `/series`, `/targets`,
  `/status/buildinfo`, `/-/healthy`, `/-/ready`

非対応（明示的に `bad_data` を返す）:

- `topk` / `bottomk` / `quantile` / `histogram_quantile`
- `or` / `and` / `unless`、`on/ignoring/group_left/group_right`
- subquery (`expr[5m:1m]`), `@` 修飾子
- recording / alerting rules、TLS、auth、リモートライト、追記 WAL（snapshot のみ）

## 一気に立ち上げる

```sh
# 1. exporter 起動（既存 PoC）
cd m_exporter/poc/go-exporter   && ./start.sh
cd ../rust-exporter             && ./start.sh

# 2. mini-prom（どちらか、または両方）
cd ../mini-prometheus/go        && ./start.sh   # :9092
cd ../rust                      && ./start.sh   # :9093

# 3. 確認
open http://localhost:9092/         # target 一覧 + /graph リンク
open http://localhost:9092/graph    # PromQL 式ブラウザ + 折れ線グラフ
curl -s http://localhost:9092/api/v1/targets | jq .data.activeTargets
curl -s 'http://localhost:9092/api/v1/query?query=m_exporter_memory_used_ratio' | jq
curl -s 'http://localhost:9092/api/v1/query?query=sum(m_exporter_cpu_usage_ratio)by(cpu)' | jq

# 4. 後始末
cd m_exporter/poc/mini-prometheus/go   && ./stop.sh
cd ../rust                             && ./stop.sh
```

## Grafana から参照する

`poc/infra/start.sh` が起動した本家 Prometheus とは別に、
mini-prom を Grafana のデータソースとして手動追加できる:

1. Grafana UI → Connections → Data sources → Add new data source → **Prometheus**
2. URL に `http://localhost:9092`（Go 版）または `http://localhost:9093`（Rust 版）
3. **Save & test** が緑になれば OK。Explore で `m_exporter_*` メトリクスをクエリ可能

## 既定ポート

| サービス             | ポート | 役割              |
| -------------------- | ------ | ----------------- |
| 本家 Prometheus      | 9090   | poc/infra         |
| mini-prom (Go)       | 9092   | このディレクトリ  |
| mini-prom (Rust)     | 9093   | このディレクトリ  |
| go-exporter          | 9100   | scrape 対象       |
| rust-exporter        | 9101   | scrape 対象       |

## 設定ファイル例

```toml
[server]
listen_addr = "0.0.0.0:9092"

[storage]
retention_samples = 720           # 15s × 3h
data_dir          = "data"        # snapshots written here; "" disables persistence
snapshot_interval = "30s"         # background save cadence; "0s" disables periodic save

[[scrape_configs]]
job_name        = "m_exporter_go"
scrape_interval = "15s"
scrape_timeout  = "10s"
metrics_path    = "/metrics"
targets         = ["localhost:9100"]

[[scrape_configs]]
job_name        = "m_exporter_rust"
scrape_interval = "15s"
scrape_timeout  = "10s"
metrics_path    = "/metrics"
targets         = ["localhost:9101"]
```
