#!/usr/bin/env bash
# Launches a Chrome instance with remote debugging enabled so any of the
# three Go collectors (raw / chromedp / rod) can attach.
#
# Usage:
#   ./scripts/launch-chrome.sh [URL] [PORT]
#
# Note: pi-all auto-launches Chrome itself — you only need this script
# when using pi-cli / pi-server against a manually-launched Chrome.
set -euo pipefail
URL="${1:-https://example.com}"
PORT="${2:-9222}"
PROFILE_DIR="${PI_PROFILE_DIR:-$(mktemp -d)}"

CHROME=""
case "$(uname -s)" in
  Darwin)
    for path in \
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
      "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
      if [[ -x "$path" ]]; then CHROME="$path"; break; fi
    done
    ;;
  *)
    for bin in google-chrome google-chrome-stable chromium chromium-browser; do
      if command -v "$bin" >/dev/null 2>&1; then CHROME="$(command -v "$bin")"; break; fi
    done
    ;;
esac

if [[ -z "$CHROME" ]]; then
  echo "no chrome/chromium binary found — install Chrome from https://www.google.com/chrome/" >&2
  exit 1
fi

echo "launching $CHROME on :$PORT (profile=$PROFILE_DIR)"
exec "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$URL"
