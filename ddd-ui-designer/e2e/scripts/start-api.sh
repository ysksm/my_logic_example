#!/usr/bin/env bash
# Start the ddd-ui-designer Go API for Playwright tests. The data dir is
# isolated under e2e/.tmp/data so tests can't pollute the developer's data.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DATA_DIR="$HERE/../.tmp/data"
PORT="${API_PORT:-8095}"

mkdir -p "$DATA_DIR"
cd "$ROOT/server"

exec go run . -addr ":$PORT" -data "$DATA_DIR"
