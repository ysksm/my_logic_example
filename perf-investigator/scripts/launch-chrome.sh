#!/usr/bin/env bash
# Launches a Chrome instance with remote debugging enabled so any of the
# three Go collectors (raw / chromedp / rod) can attach.
#
# Usage:
#   ./scripts/launch-chrome.sh [URL] [PORT]
set -euo pipefail
URL="${1:-https://example.com}"
PORT="${2:-9222}"
PROFILE_DIR="${PI_PROFILE_DIR:-$(mktemp -d)}"

for bin in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$bin" >/dev/null 2>&1; then
    CHROME="$bin"
    break
  fi
done

if [[ -z "${CHROME:-}" ]]; then
  echo "no chrome/chromium binary found on PATH" >&2
  exit 1
fi

echo "launching $CHROME on :$PORT (profile=$PROFILE_DIR)"
exec "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$URL"
