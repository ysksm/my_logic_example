# poc — Prometheus exporter PoC

`lab/` での技術調査をもとに、Go と Rust それぞれで Prometheus exporter の最小実装を行ったディレクトリ。
両者は **同じメトリクス名・ラベル・意味** で値を返す（dashboards は共通利用可）。

## サブディレクトリ

| ディレクトリ      | 言語 | 既定ポート | Web フレームワーク | metrics クライアント                     |
| ----------------- | ---- | ---------- | ------------------ | ---------------------------------------- |
| `go-exporter/`    | Go   | `9100`     | `net/http` (stdlib)| `prometheus/client_golang`               |
| `rust-exporter/`  | Rust | `9101`     | `axum 0.7`         | `prometheus-client 0.22`（公式）         |

## 共通スコープ

- メトリクス: CPU 使用率（per-core + total）+ メモリ + swap のみ。disk/network/load は次フェーズ
- 収集モデル: バックグラウンドで `interval` 周期に取得 → cache → `/metrics` で返却
- 命名: `m_exporter_*` プレフィクス、比率は `*_ratio`(0-1)、サイズは `*_bytes`、累積カウンタは `*_total`
- 設定: TOML、コマンドラインで `--config` のパスを差し替え可能

## ポート

衝突を避けるため Go=9100、Rust=9101。両方同時に動かして同じ Prometheus からスクレイプ可能。

## 動作確認

```sh
# 端末 A
cd poc/go-exporter && go run . --config config.toml

# 端末 B
cd poc/rust-exporter && cargo run --release -- --config config.toml

# 端末 C
curl -s http://127.0.0.1:9100/metrics | grep ^m_exporter_
curl -s http://127.0.0.1:9101/metrics | grep ^m_exporter_
```

## Prometheus 側のスクレイプ設定例

```yaml
scrape_configs:
  - job_name: m_exporter_go
    static_configs:
      - targets: ['localhost:9100']
  - job_name: m_exporter_rust
    static_configs:
      - targets: ['localhost:9101']
```
