# mini-prometheus (Go)

Prometheus 本体相当の最小実装（Go 版）。標準ライブラリ + `BurntSushi/toml` のみで、
scrape ループ・インメモリ TSDB・PromQL サブセット・HTTP API 互換層を実装している。

## 起動

```sh
./start.sh                                          # ビルド + バックグラウンド起動 (port 9092)
curl -s http://localhost:9092/-/ready
curl -s http://localhost:9092/api/v1/targets | jq
./stop.sh
```

ログ: `.run/server.log`、PID: `.run/server.pid`

## 設定

`config.toml`:

```toml
[server]
listen_addr = "0.0.0.0:9092"

[storage]
retention_samples = 720          # 系列ごとの ring buffer 容量

[[scrape_configs]]
job_name        = "m_exporter_go"
scrape_interval = "15s"
scrape_timeout  = "10s"
metrics_path    = "/metrics"
targets         = ["localhost:9100"]
```

## 実装ファイル

| ファイル              | 内容                                        |
| --------------------- | ------------------------------------------- |
| `main.go`             | HTTP サーバ + シグナル + graceful shutdown  |
| `config.go`           | TOML ローダ + `duration` 型                 |
| `storage.go`          | Labels / Series ring buffer / posting index |
| `parser_textfmt.go`   | Prometheus text format パーサ               |
| `scrape.go`           | スクレイプワーカー (1 goroutine / target)   |
| `promql_lex.go`       | PromQL 字句解析                             |
| `promql_parse.go`     | PromQL 構文解析（AST）                      |
| `promql_eval.go`      | PromQL 評価エンジン                         |
| `api.go`              | `/api/v1/*` ハンドラ                        |
| `web.go`              | `/` のターゲット一覧 HTML                   |

## PromQL サブセット

実装済:

- ベクタセレクタ `metric{l="v", l!="v", l=~"re", l!~"re"}`
- 範囲セレクタ `metric[5m]`、`offset 5m`
- 二項演算 `+ - * / %`、比較 `== != < > <= >=`（`bool` 修飾子）
- 集約 `sum / avg / max / min / count` （`by(...)` / `without(...)`）
- 関数 `rate, irate, increase, delta, *_over_time, time, vector, scalar, abs, clamp_min, clamp_max`

未実装（パーサが `bad_data` を返す）:

- `topk / bottomk / quantile / histogram_quantile`
- セット演算子 `or / and / unless`、`on/ignoring/group_left/group_right`
- subquery `expr[5m:1m]`、`@` 修飾子

## HTTP API

| パス                              | 説明                                     |
| --------------------------------- | ---------------------------------------- |
| `GET /api/v1/query`               | instant query                            |
| `GET /api/v1/query_range`         | range query                              |
| `GET /api/v1/labels`              | 全ラベル名                               |
| `GET /api/v1/label/<name>/values` | ラベル値                                 |
| `GET /api/v1/series`              | match[] にマッチした系列                 |
| `GET /api/v1/targets`             | スクレイプ状況                           |
| `GET /api/v1/status/buildinfo`    | ダミー buildinfo（Grafana 互換性のため） |
| `GET /-/healthy`, `/-/ready`      | ヘルスチェック                           |

## テスト

```sh
go test ./...
```
