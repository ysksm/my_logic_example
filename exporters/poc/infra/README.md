# infra — Prometheus + Grafana ローカル起動スクリプト

Docker は使わず、Prometheus と Grafana の公式リリースバイナリをダウンロードして
ローカル（macOS）で直接起動するためのスクリプト群。

## バージョン

| 製品       | バージョン | アーキ             | 備考                                                     |
| ---------- | ---------- | ------------------ | -------------------------------------------------------- |
| Prometheus | 3.5.2      | `darwin-arm64`     | Apple Silicon ネイティブ                                 |
| Grafana    | 13.0.1     | `darwin_amd64`     | Apple Silicon では Rosetta 経由で起動（公式 amd64 ビルド）|

ダウンロード元 URL は `init.sh` 冒頭の変数で定義しているので、
arm64 版に差し替える等のカスタマイズが必要なら直接編集する。

## ファイル

```
infra/
├── init.sh    # ダウンロード + 展開 + 設定ファイル生成
├── start.sh   # 両プロセスをバックグラウンド起動
├── stop.sh    # 停止
├── data/      # 生成物（git 管理外）
│   ├── downloads/                   # tarball キャッシュ
│   ├── prometheus-3.5.2.darwin-arm64/
│   ├── grafana-13.0.1/
│   ├── prometheus.yml               # Prometheus の scrape 設定
│   ├── grafana-conf/                # Grafana の ini と provisioning
│   ├── prometheus-data/             # TSDB
│   ├── grafana-data/                # Grafana の SQLite 等
│   ├── grafana-logs/
│   ├── grafana-plugins/
│   ├── logs/                        # 起動ログ
│   ├── prometheus.pid
│   └── grafana.pid
└── README.md
```

## 使い方

```sh
cd infra

# 1. 初期化（初回のみ。tarball が無ければダウンロード、無ければ展開）
./init.sh

# 2. 起動
./start.sh
# → http://localhost:9090   Prometheus
# → http://localhost:3000   Grafana (admin / admin)

# 3. 停止
./stop.sh
```

`init.sh` は idempotent。再実行しても既存ファイルがあればスキップする。
完全にクリーンにしたい場合は `data/` を丸ごと消す。

## scrape 対象

`init.sh` が生成する `data/prometheus.yml` で以下を `localhost:` に対して scrape:

| job 名             | ターゲット            | 内容                       |
| ------------------ | --------------------- | -------------------------- |
| `prometheus`       | `localhost:9090`      | Prometheus 自身             |
| `mac_exporter_go`  | `localhost:9100`      | `poc/mac/go-exporter` 起動時    |
| `mac_exporter_rust`| `localhost:9101`      | `poc/mac/rust-exporter` 起動時  |

exporter が起動していなければ Prometheus 上で `DOWN` と表示されるだけで害は無い。
両方起動した状態で http://localhost:9090/targets を開いて状態を確認できる。

## Grafana の datasource

`init.sh` で `data/grafana-conf/provisioning/datasources/prometheus.yml` を書き出す。
初回起動時に Grafana が自動で `Prometheus` データソース（`http://localhost:9090`）を作成するので、
ログイン後すぐ Explore で PromQL を叩ける。

## メモ

- 全プロセスは `nohup` でバックグラウンド起動。ターミナルを閉じても動き続ける
- Prometheus / Grafana の停止は `./stop.sh` で `SIGTERM` → 10 秒待って残っていたら `SIGKILL`
- ポート競合（9090 / 3000）が発生する場合は `data/prometheus.yml` の `--web.listen-address`、
  `data/grafana-conf/grafana.ini` の `[server] http_port` を編集する
