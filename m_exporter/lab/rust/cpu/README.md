# lab/rust/cpu — CPU 使用率取得 PoC（Rust）

`sysinfo` クレートで 1 秒間隔に total / per-core CPU 使用率をコンソール出力します。
Go 版（`lab/go/cpu/`）と同等の出力を意図しています。

## 実行

```sh
cd lab/rust/cpu
cargo run --release
```

出力例:

```
CPU cores (logical): 16
Sampling every 1s. Press Ctrl-C to stop.
[20:32:26] total= 20.1%  cpu0= 78.9%  cpu1= 75.0% ... cpu15=  0.0%
```

## 仕様メモ

- `System::new_with_specifics(RefreshKind::new().with_cpu(...))` で CPU だけ取る軽量モードに
- `sysinfo` は **2 回連続で `refresh_cpu_all` を呼び、その間隔から差分を計算する** 仕組み。
  初回呼び出し直後に `MINIMUM_CPU_UPDATE_INTERVAL`（200ms 程度）待ってから 2 回目を呼ばないと値が 0 になる
- `sys.global_cpu_usage()` … 全コア合算 / `sys.cpus()[i].cpu_usage()` … per-core
- Ctrl-C は `ctrlc::set_handler` で `AtomicBool` を倒してループを抜ける
