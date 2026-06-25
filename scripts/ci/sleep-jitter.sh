#!/usr/bin/env bash
# Sleep BASE_SECONDS ± JITTER_SECONDS (uniform random). Makes pause timing less mechanical.
# Usage: sleep-jitter.sh BASE_SECONDS [JITTER_SECONDS]
# Env: LH_PAUSE_JITTER_SEC overrides default jitter (3).
set -euo pipefail

base="${1:?base seconds required}"
jitter="${2:-${LH_PAUSE_JITTER_SEC:-3}}"

if ! [[ "$base" =~ ^[0-9]+$ ]] || ! [[ "$jitter" =~ ^[0-9]+$ ]]; then
  echo "sleep-jitter: base and jitter must be non-negative integers" >&2
  exit 1
fi

offset=0
if [ "$jitter" -gt 0 ]; then
  offset=$((RANDOM % (jitter * 2 + 1) - jitter))
fi

total=$((base + offset))
if [ "$total" -lt 0 ]; then
  total=0
fi

echo "Sleeping ${total}s (${base}s ± ${jitter}s jitter)…" >&2
sleep "$total"
