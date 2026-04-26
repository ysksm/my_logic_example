#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"
BIN="./target/release/mini-prometheus-rust"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[skip] mini-prom (rust) already running (pid $(cat "$PID_FILE"))"
  exit 0
fi

echo "[build] cargo build --release"
cargo build --release

echo "[start] mini-prom (rust) --config config.toml"
nohup "$BIN" --config config.toml >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

cat <<EOF
[started] pid $(cat "$PID_FILE")
  log      : $(pwd)/$LOG_FILE
  ui       : http://localhost:9093/
  api      : http://localhost:9093/api/v1/targets
  stop     : ./stop.sh
EOF
