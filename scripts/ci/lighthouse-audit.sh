#!/usr/bin/env bash
# Run one Lighthouse audit with warmup + retry (used by GitHub Actions).
set -euo pipefail

page_url="$1"
strategy="$2"
output_path="$3"
chrome_path="$4"
timeout_sec="${5:-60}"

LH_MAX_WAIT_FCP="${LH_MAX_WAIT_FCP:-35000}"
LH_MAX_WAIT_LOAD_DESKTOP="${LH_MAX_WAIT_LOAD_DESKTOP:-45000}"
LH_MAX_WAIT_LOAD_MOBILE="${LH_MAX_WAIT_LOAD_MOBILE:-60000}"
CHROME_FLAGS="${CHROME_FLAGS:---headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-blink-features=AutomationControlled}"
LH_USER_AGENT="${LH_USER_AGENT:-Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36}"

if [ "$strategy" = "desktop" ]; then
  max_load="$LH_MAX_WAIT_LOAD_DESKTOP"
  extra_args=(--preset=desktop)
else
  max_load="$LH_MAX_WAIT_LOAD_MOBILE"
  extra_args=(--form-factor=mobile)
fi

warmup() {
  curl -fsSL -A "$LH_USER_AGENT" -o /dev/null --max-time 30 "$page_url" || true
}

run_once() {
  local screenshot_args=(--disable-full-page-screenshot)
  if [ "${STORE_SCREENSHOTS:-0}" = "1" ] || [ "${STORE_SCREENSHOTS:-}" = "true" ]; then
    screenshot_args=()
  fi
  timeout "$timeout_sec" lighthouse "$page_url" \
    --chrome-path="$chrome_path" \
    --chrome-flags="$CHROME_FLAGS" \
    --user-agent="$LH_USER_AGENT" \
    "${extra_args[@]}" \
    "${screenshot_args[@]}" \
    --max-wait-for-fcp="$LH_MAX_WAIT_FCP" \
    --max-wait-for-load="$max_load" \
    --output=json \
    --output-path="$output_path" \
    --quiet
}

for attempt in 1 2; do
  warmup
  if run_once; then
    exit 0
  fi
  if [ "$attempt" -eq 1 ]; then
    echo "Attempt $attempt failed for $page_url ($strategy), retrying in 8s…" >&2
    sleep 8
  fi
done

echo "Lighthouse failed for $page_url ($strategy) after 2 attempts" >&2
exit 1
