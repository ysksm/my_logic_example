#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"
BIN="./mini_prometheus_go"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[skip] mini-prom (go) already running (pid $(cat "$PID_FILE"))"
  exit 0
fi

echo "[build] go build -o $BIN ."
go build -o "$BIN" .

echo "[start] mini-prom (go) --config config.toml"
nohup "$BIN" --config config.toml >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

cat <<EOF
[started] pid $(cat "$PID_FILE")
  log      : $(pwd)/$LOG_FILE
  ui       : http://localhost:9092/
  api      : http://localhost:9092/api/v1/targets
  stop     : ./stop.sh
EOF
