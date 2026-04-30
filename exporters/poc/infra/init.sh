#!/usr/bin/env bash
set -euo pipefail

# Download Prometheus + Grafana, extract, and write their config files.
# Idempotent: rerunning it skips work that's already done.
# After this completes, run ./start.sh to launch the services.

cd "$(dirname "$0")"
INFRA_DIR="$(pwd)"
DATA_DIR="$INFRA_DIR/data"
DOWNLOADS="$DATA_DIR/downloads"

PROM_VERSION="3.5.2"
PROM_ARCH="darwin-arm64"
PROM_DIR_NAME="prometheus-${PROM_VERSION}.${PROM_ARCH}"
PROM_TARBALL="${PROM_DIR_NAME}.tar.gz"
PROM_URL="https://github.com/prometheus/prometheus/releases/download/v${PROM_VERSION}/${PROM_TARBALL}"

GRAFANA_VERSION="13.0.1"
GRAFANA_BUILD_ID="24542347077"
GRAFANA_ARCH="darwin_arm64"
GRAFANA_PKG="grafana-enterprise"
GRAFANA_TARBALL="${GRAFANA_PKG}_${GRAFANA_VERSION}_${GRAFANA_BUILD_ID}_${GRAFANA_ARCH}.tar.gz"
GRAFANA_URL="https://dl.grafana.com/${GRAFANA_PKG}/release/${GRAFANA_VERSION}/${GRAFANA_TARBALL}"
GRAFANA_DIR_NAME="${GRAFANA_PKG}-${GRAFANA_VERSION}"

mkdir -p \
  "$DOWNLOADS" \
  "$DATA_DIR/prometheus-data" \
  "$DATA_DIR/grafana-data" \
  "$DATA_DIR/grafana-logs" \
  "$DATA_DIR/grafana-plugins" \
  "$DATA_DIR/grafana-conf/provisioning/datasources" \
  "$DATA_DIR/grafana-conf/provisioning/dashboards" \
  "$DATA_DIR/logs"

download() {
  local url="$1" dest="$2"
  if [ -f "$dest" ]; then
    echo "[skip] already downloaded: ${dest##*/}"
  else
    echo "[download] $url"
    curl -fL --retry 3 -o "$dest" "$url"
  fi
}

extract() {
  local tarball="$1" marker_dir="$2"
  if [ -d "$marker_dir" ]; then
    echo "[skip] already extracted: ${marker_dir##*/}"
  else
    echo "[extract] ${tarball##*/} -> $DATA_DIR/"
    tar -xzf "$tarball" -C "$DATA_DIR"
  fi
}

download "$PROM_URL"    "$DOWNLOADS/$PROM_TARBALL"
extract  "$DOWNLOADS/$PROM_TARBALL" "$DATA_DIR/$PROM_DIR_NAME"

download "$GRAFANA_URL" "$DOWNLOADS/$GRAFANA_TARBALL"
extract  "$DOWNLOADS/$GRAFANA_TARBALL" "$DATA_DIR/$GRAFANA_DIR_NAME"

cat > "$DATA_DIR/prometheus.yml" <<'EOF'
global:
  scrape_interval: 15s
  scrape_timeout: 10s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']

  - job_name: mac_exporter_go
    static_configs:
      - targets: ['localhost:9100']

  - job_name: mac_exporter_rust
    static_configs:
      - targets: ['localhost:9101']
EOF

cat > "$DATA_DIR/grafana-conf/provisioning/datasources/prometheus.yml" <<'EOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://localhost:9090
    isDefault: true
    editable: true
EOF

cat > "$DATA_DIR/grafana-conf/grafana.ini" <<EOF
[paths]
data         = $DATA_DIR/grafana-data
logs         = $DATA_DIR/grafana-logs
plugins      = $DATA_DIR/grafana-plugins
provisioning = $DATA_DIR/grafana-conf/provisioning

[server]
http_port = 3000

[security]
admin_user     = admin
admin_password = admin

[analytics]
reporting_enabled = false
check_for_updates = false
EOF

cat <<EOF

[init done]
  prometheus binary : $DATA_DIR/$PROM_DIR_NAME/prometheus
  grafana binary    : $DATA_DIR/$GRAFANA_DIR_NAME/bin/grafana
  prometheus config : $DATA_DIR/prometheus.yml
  grafana config    : $DATA_DIR/grafana-conf/grafana.ini

Next: ./start.sh
EOF
