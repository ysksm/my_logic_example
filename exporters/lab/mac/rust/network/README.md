# lab/mac/rust/network — ネットワーク I/O 取得 PoC（Rust）

`sysinfo` の `Networks` で起動時にインターフェース一覧を、その後 2 秒間隔で
per-interface の I/O 差分を出力します。Go 版（`lab/mac/go/network/`）の Rust 移植です。

## 実行

```sh
cd lab/mac/rust/network
cargo run --release
```

出力例:

```
== Network interfaces ==
  en0         mac=b2:95:c7:37:21:2e  addrs=[192.168.86.120/24, ...]
  ...

== Per-interface I/O delta every 2s. Press Ctrl-C to stop. ==
[10:01:50]
  en0         rx=85.40 Kbps  tx=12.30 Kbps  rx_pkts=42  tx_pkts=33  errs(in/out)=0/0
```

## 仕様メモ

- `Networks::new_with_refreshed_list()` で初期化、以降 `nets.refresh()` を呼ぶと
  **「前回 refresh からの差分」が `received() / transmitted()` で返る**（gopsutil は累積値が返るので扱いが違う）
- そのため自前で前回値を保持する必要が無く、コードが Go 版より少しシンプル
- `mac_address()` / `ip_networks()` も取れる
- gopsutil で取れた `Dropin / Dropout` は sysinfo では未公開

## Go 版との差分メモ

- gopsutil: 累積カウンタ → 自分で diff
- sysinfo: refresh 単位の delta → そのまま使える
