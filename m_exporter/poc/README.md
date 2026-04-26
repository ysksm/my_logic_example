# poc — Prometheus exporter PoC

`lab/` の技術調査を元に、Go と Rust それぞれで Prometheus exporter の最小実装と、
それを観測する Prometheus + Grafana スタックを揃えたディレクトリ。
両 exporter は **同じメトリクス名・ラベル・意味** で値を返すので、同じ dashboard を共用できる。

## ディレクトリ

| ディレクトリ        | 内容                                                                       | 既定ポート       |
| ------------------- | -------------------------------------------------------------------------- | ---------------- |
| `go-exporter/`      | Go 実装の exporter。`net/http` + `prometheus/client_golang` + `gopsutil`   | `9100`           |
| `rust-exporter/`    | Rust 実装の exporter。`axum` + `prometheus-client` + `sysinfo`             | `9101`           |
| `infra/`            | Prometheus 3.5.2 + Grafana 13.0.1 をローカル起動するスクリプト             | `9090` / `3000`  |
| `mini-prometheus/`  | Prometheus 本体相当 (TSDB + scrape + PromQL + HTTP API) の最小再実装       | `9092` / `9093`  |

## 共通スコープ

- メトリクス: CPU 使用率（per-core + total）+ メモリ + swap（disk/network/load は次フェーズ）
- 収集モデル: バックグラウンドで `interval` 周期に取得 → cache → `/metrics` で返却
- 命名: `m_exporter_*` プレフィクス、比率は `*_ratio` (0-1)、サイズは `*_bytes`、累積は `*_total`
- 設定: TOML、`--config <path>` で差し替え可

## 一気に立ち上げる

```sh
# 1. 監視スタック（初回のみ init）
cd poc/infra
./init.sh        # Prometheus / Grafana のダウンロード + 設定生成
./start.sh       # 起動

# 2. exporter（別ターミナル不要、それぞれバックグラウンド起動）
cd ../go-exporter   && ./start.sh
cd ../rust-exporter && ./start.sh

# 3. 確認
curl -s http://localhost:9100/metrics | grep ^m_exporter_ | head
curl -s http://localhost:9101/metrics | grep ^m_exporter_ | head
open http://localhost:9090/targets       # Prometheus
open http://localhost:3000               # Grafana (admin / admin)

# 4. （任意）本家 Prometheus の代わりに mini-prom を使う
cd ../mini-prometheus/go    && ./start.sh    # :9092
cd ../rust                  && ./start.sh    # :9093
curl -s 'http://localhost:9092/api/v1/query?query=sum(m_exporter_cpu_usage_ratio)by(cpu)' | jq

# 5. 全部止める
cd poc/rust-exporter        && ./stop.sh
cd ../go-exporter           && ./stop.sh
cd ../infra                 && ./stop.sh
cd ../mini-prometheus/go    && ./stop.sh
cd ../rust                  && ./stop.sh
```

## 各サービスの runtime 配置

`*.pid` と `*.log` は対象ディレクトリ配下に置き、`.gitignore` 済み:

| サービス         | PID                                | ログ                                 |
| ---------------- | ---------------------------------- | ------------------------------------ |
| `go-exporter`    | `poc/go-exporter/.run/exporter.pid`| `poc/go-exporter/.run/exporter.log`  |
| `rust-exporter`  | `poc/rust-exporter/.run/exporter.pid` | `poc/rust-exporter/.run/exporter.log` |
| Prometheus       | `poc/infra/data/prometheus.pid`    | `poc/infra/data/logs/prometheus.log` |
| Grafana          | `poc/infra/data/grafana.pid`       | `poc/infra/data/logs/grafana.log`    |
| mini-prom (go)   | `poc/mini-prometheus/go/.run/server.pid`   | `poc/mini-prometheus/go/.run/server.log`   |
| mini-prom (rust) | `poc/mini-prometheus/rust/.run/server.pid` | `poc/mini-prometheus/rust/.run/server.log` |

## Prometheus scrape 設定

`poc/infra/init.sh` が生成する `data/prometheus.yml`:

```yaml
scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
  - job_name: m_exporter_go
    static_configs:
      - targets: ['localhost:9100']
  - job_name: m_exporter_rust
    static_configs:
      - targets: ['localhost:9101']
```
