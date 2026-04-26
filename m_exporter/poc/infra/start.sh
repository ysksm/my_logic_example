#!/usr/bin/env bash
set -euo pipefail

# Launch Prometheus and Grafana in the background.
# Requires ./init.sh to have been run first.
# PIDs and logs are kept under data/.

cd "$(dirname "$0")"
INFRA_DIR="$(pwd)"
DATA_DIR="$INFRA_DIR/data"

PROM_HOME="$(echo "$DATA_DIR"/prometheus-*.darwin-* 2>/dev/null | awk '{print $1}')"
GRAFANA_HOME="$(echo "$DATA_DIR"/grafana-[0-9]* 2>/dev/null | awk '{print $1}')"

if [ ! -x "${PROM_HOME:-}/prometheus" ]; then
  echo "Prometheus not found under $DATA_DIR. Run ./init.sh first." >&2
  exit 1
fi
if [ ! -x "${GRAFANA_HOME:-}/bin/grafana" ]; then
  echo "Grafana not found under $DATA_DIR. Run ./init.sh first." >&2
  exit 1
fi

PROM_PID_FILE="$DATA_DIR/prometheus.pid"
GRAFANA_PID_FILE="$DATA_DIR/grafana.pid"
PROM_LOG="$DATA_DIR/logs/prometheus.log"
GRAFANA_LOG="$DATA_DIR/logs/grafana.log"

is_running() {
  local pidfile="$1"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

if is_running "$PROM_PID_FILE"; then
  echo "[skip] prometheus already running (pid $(cat "$PROM_PID_FILE"))"
else
  echo "[start] prometheus"
  nohup "$PROM_HOME/prometheus" \
    --config.file="$DATA_DIR/prometheus.yml" \
    --storage.tsdb.path="$DATA_DIR/prometheus-data" \
    --web.listen-address=:9090 \
    >"$PROM_LOG" 2>&1 &
  echo $! > "$PROM_PID_FILE"
fi

if is_running "$GRAFANA_PID_FILE"; then
  echo "[skip] grafana already running (pid $(cat "$GRAFANA_PID_FILE"))"
else
  echo "[start] grafana"
  (
    cd "$GRAFANA_HOME"
    nohup ./bin/grafana server \
      --homepath "$GRAFANA_HOME" \
      --config "$DATA_DIR/grafana-conf/grafana.ini" \
      >"$GRAFANA_LOG" 2>&1 &
    echo $! > "$GRAFANA_PID_FILE"
  )
fi

cat <<EOF

[started]
  Prometheus  : http://localhost:9090   (pid $(cat "$PROM_PID_FILE"), log $PROM_LOG)
  Grafana     : http://localhost:3000   (pid $(cat "$GRAFANA_PID_FILE"), log $GRAFANA_LOG, admin/admin)

Targets: http://localhost:9090/targets
Stop   : ./stop.sh
EOF
