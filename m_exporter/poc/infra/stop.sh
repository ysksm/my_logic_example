#!/usr/bin/env bash
set -euo pipefail

# Stop Prometheus and Grafana started by ./start.sh.

cd "$(dirname "$0")"
DATA_DIR="$(pwd)/data"

stop_pid() {
  local name="$1" pidfile="$2"
  if [ ! -f "$pidfile" ]; then
    echo "[skip] $name: no pidfile"
    return
  fi
  local pid
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "[stop] $name (pid $pid)"
    kill "$pid"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "[force] $name still alive, sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  else
    echo "[skip] $name: pid $pid not running"
  fi
  rm -f "$pidfile"
}

stop_pid prometheus "$DATA_DIR/prometheus.pid"
stop_pid grafana    "$DATA_DIR/grafana.pid"
