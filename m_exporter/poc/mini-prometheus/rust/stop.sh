#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
PID_FILE=".run/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "[skip] no pidfile"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  echo "[stop] mini-prom (rust) (pid $PID)"
  kill "$PID"
  for _ in 1 2 3 4 5; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "[force] still alive, sending SIGKILL"
    kill -KILL "$PID" 2>/dev/null || true
  fi
else
  echo "[skip] pid $PID not running"
fi
rm -f "$PID_FILE"
