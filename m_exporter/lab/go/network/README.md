# lab/go/network — ネットワーク I/O 取得 PoC

`gopsutil/v4/net` で起動時にインターフェース一覧を、その後 2 秒間隔で I/O カウンタの差分を出力します。

## 実行

```sh
cd lab/go/network
go run .
```

出力例:

```
== Network interfaces ==
  lo0         mtu=16384  flags=[up loopback multicast]  addrs=[127.0.0.1/8 ...]
  en0         mtu=1500   flags=[up broadcast multicast]  addrs=[192.168.86.120/24 ...]
  ...

== Per-interface I/O delta every 2s. Press Ctrl-C to stop. ==
[20:29:54]
  en0         rx=69.50 Kbps  tx=303.23 Kbps  rx_pkts=79  tx_pkts=66  errs(in/out)=0/0  drops(in/out)=0/0
```

## 取得項目

- `net.Interfaces()` … 名前 / MTU / Flags / IP アドレス
- `net.IOCounters(true)` … per-interface の `BytesRecv / BytesSent / PacketsRecv / PacketsSent / Errin / Errout / Dropin / Dropout`
  （`false` を渡すと全インターフェース合算）
- 帯域はネットワーク慣習に合わせ **bps**（bit per second）で表示

## メモ

- macOS では `utunN`（VPN）、`bridgeN`（VM network）、`awdl0` / `llw0`（Apple Wireless Direct）など多数の仮想 IF が見える。Exporter 化の際は `en*` だけ等の名前フィルタが必須
- `Errin / Errout / Dropin / Dropout` は macOS でも `getifaddrs` 経由で取れている
- `lo0` は基本的にカウントしない方が運用上クリーン
