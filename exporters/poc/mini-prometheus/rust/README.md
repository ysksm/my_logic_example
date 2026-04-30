# mini-prometheus (Rust)

Prometheus 本体相当の最小実装（Rust 版）。`axum` + `tokio` + `reqwest` + `regex` で、
scrape ループ・インメモリ TSDB・PromQL サブセット・HTTP API 互換層を実装している。
Go 版 (`../go/`) と **同じ TOML スキーマ・同じ PromQL サブセット・同じ JSON レスポンス形式**。

## 起動

```sh
./start.sh                                          # ビルド + バックグラウンド起動 (port 9093)
curl -s http://localhost:9093/-/ready
curl -s http://localhost:9093/api/v1/targets | jq
./stop.sh
```

ログ: `.run/server.log`、PID: `.run/server.pid`

## 設定

`config.toml`:

```toml
[server]
listen_addr = "0.0.0.0:9093"

[storage]
retention_samples = 720          # 系列ごとの ring buffer 容量

[[scrape_configs]]
job_name        = "mac_exporter_rust"
scrape_interval = "15s"
scrape_timeout  = "10s"
metrics_path    = "/metrics"
targets         = ["localhost:9101"]
```

## 実装ファイル

| ファイル                  | 内容                                        |
| ------------------------- | ------------------------------------------- |
| `src/main.rs`             | tokio runtime + axum サーバ + signal        |
| `src/config.rs`           | TOML ローダ（`humantime_serde` で duration）|
| `src/storage.rs`          | Labels / Series ring buffer / matcher       |
| `src/parser.rs`           | Prometheus text format パーサ               |
| `src/scrape.rs`           | スクレイプワーカー (1 task / target)        |
| `src/promql/lex.rs`       | PromQL 字句解析                             |
| `src/promql/parse.rs`     | PromQL 構文解析（AST）                      |
| `src/promql/eval.rs`      | PromQL 評価エンジン                         |
| `src/api.rs`              | `/api/v1/*` ハンドラ                        |
| `src/web.rs`              | `/` のターゲット一覧 HTML                   |

## PromQL サブセット

実装済 / 未実装の一覧は親 README (`../README.md`) と同じ。

## テスト

```sh
cargo test
```

## 開発時の手動実行

```sh
cargo run -- --config config.toml
```
