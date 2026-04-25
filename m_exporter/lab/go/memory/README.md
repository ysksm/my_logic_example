# lab/go/memory — メモリ使用量取得 PoC

`gopsutil/v4/mem` を使い、物理メモリと swap の使用状況を 1 秒間隔でコンソール出力します。

## 実行

```sh
cd lab/go/memory
go run .
```

出力例（128 GiB / Apple Silicon）:

```
Total memory: 128.0GiB
Sampling every 1s. Press Ctrl-C to stop.
[20:15:03] used=37.8GiB/128.0GiB ( 29.5%)  available=90.2GiB  free=55.0GiB  active=32.7GiB  inactive=35.1GiB  wired=4.2GiB  swap=0B/0B (  0.0%)
```

## 取得している項目

`mem.VirtualMemoryStat` のうち macOS で意味のあるフィールドを抜粋。

| 項目         | 内容                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `Total`      | 物理メモリの総量                                                                                  |
| `Used`       | `Total - Free - Buffers - Cached` 相当（gopsutil 実装定義）                                        |
| `UsedPercent`| `Used / Total * 100`                                                                              |
| `Available`  | アプリが追加で確保できる見込み量（`free + inactive` などから推定）                                |
| `Free`       | OS が即座に渡せる純粋な空き                                                                        |
| `Active`     | 直近で参照されたページ                                                                            |
| `Inactive`   | 一定時間参照されていないページ（必要なら回収可）                                                  |
| `Wired`      | カーネル等によりロックされ、ページアウト不可                                                      |

`mem.SwapMemoryStat` から `swap.Total / Used / UsedPercent` も合わせて表示。

## メモ

- macOS の Activity Monitor が表示する「メモリプレッシャー」「アプリメモリ」「圧縮」は gopsutil では直接は取れない。
  必要なら `vm_stat` コマンドのパース、または `host_statistics64` を直接呼ぶ実装を検討する。
- swap が `0B/0B` なのは macOS でまだ swap ファイルが作られていない（メモリに余裕がある）状態を示すだけで、不具合ではない。
- 単位表示は KiB/MiB/GiB（1024 ベース）で揃えている。
