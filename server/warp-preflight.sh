#!/usr/bin/env bash
# =============================================================================
# WARP pre-flight canary for the Facebook Radar.
#
# Probes a known-good store root feed through the WARP SOCKS5 proxy BEFORE the
# scraper starts. If Facebook is serving the flagged-egress consent/error shell
# (< 500KB or "<title>Error</title>"), rotates the WARP identity autonomously
# (zero prompts: always --accept-tos) and re-verifies, so `node radar-scraper.mjs`
# never boots onto a blocked IP.
#
# Called by run.sh with `|| true`: preflight failure must never block the run —
# the in-flight auto-heal layer in radar-scraper.mjs is the second line of
# defense and rotates mid-run if needed.
# =============================================================================

set -u

WARP_PROXY="socks5h://127.0.0.1:40000"
CANARY_URL="https://www.facebook.com/kazyonegypt"
CANARY_MIN_BYTES=500000
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

rotate_warp() {
  echo "[radar] Preflight: rotating WARP identity (--accept-tos, zero prompt)..."
  warp-cli --accept-tos disconnect || true
  sleep 2
  warp-cli --accept-tos connect || true
  sleep 3
  local trace
  trace="$(curl -s -x "$WARP_PROXY" --max-time 10 https://cloudflare.com/cdn-cgi/trace || true)"
  if echo "$trace" | grep -q "warp=on"; then
    echo "[radar] Preflight rotation verified: fresh egress (warp=on)."
    return 0
  fi
  echo "[radar] Preflight WARNING: could not verify warp=on after rotation."
  return 1
}

probe_canary() {
  local tmp
  tmp="$(mktemp)"
  curl -s -L -x "$WARP_PROXY" \
    -H "User-Agent: $UA" \
    -H "Accept-Language: ar-EG,ar;q=0.9,en-US;q=0.8" \
    -H "Cookie: locale=ar_AR; wd=1440x900;" \
    --max-time 25 \
    -o "$tmp" \
    "$CANARY_URL" || true

  local size
  size="$(wc -c < "$tmp" | tr -d '[:space:]')"
  if [ "$size" -lt "$CANARY_MIN_BYTES" ] || grep -qi "<title>[[:space:]]*Error[[:space:]]*</title>" "$tmp"; then
    rm -f "$tmp"
    echo "$size"
    return 1
  fi
  rm -f "$tmp"
  echo "$size"
  return 0
}

size="$(probe_canary)"
if [ "$size" -ge "$CANARY_MIN_BYTES" ]; then
  echo "[radar] Preflight canary OK (${size}B). Egress healthy; launching scraper."
  exit 0
fi

echo "[radar] Preflight: egress block detected on canary (${size:-0}B < ${CANARY_MIN_BYTES}B or error shell). Auto-healing: rotating WARP IP..."
if rotate_warp; then
  # Re-probe once after rotation for visibility; do not fail the run either way.
  size2="$(probe_canary)"
  if [ "$size2" -ge "$CANARY_MIN_BYTES" ]; then
    echo "[radar] Auto-healing succeeded! Acquired clean IP (${size2}B). Proceeding..."
  else
    echo "[radar] Preflight: canary still flagged after rotation (${size2:-0}B); scraper will auto-heal per-fetch."
  fi
fi

exit 0
