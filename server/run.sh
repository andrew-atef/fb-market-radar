#!/usr/bin/env bash
# =============================================================================
# Facebook Radar launcher (/opt/fb-radar/run.sh) — systemd entrypoint.
#
# 1. Loads secrets from /opt/fb-radar/radar.env when present.
#    MIGRATION NOTE: if WORKER_URL / WORKER_KEY / RADAR_* used to be inlined
#    into an older run.sh, move them into radar.env (KEY=VALUE lines, no
#    export needed — the script exports everything it sources). Then pull the
#    new run.sh; nothing else in the systemd unit changes.
# 2. Runs the WARP preflight canary (auto-rotates a flagged egress IP before
#    the scraper boots). Never fails the run.
# 3. Execs the scraper; radar-scraper.mjs itself auto-detects blocks mid-run
#    and rotates WARP autonomously (see fetchUrlViaWarpAuto).
# =============================================================================

set -u
cd "$(dirname "$0")"

if [ -f ./radar.env ]; then
  echo "[radar] Loading environment from radar.env"
  set -a
  # shellcheck disable=SC1091
  . ./radar.env
  set +a
else
  echo "[radar] WARNING: ./radar.env not found." >&2
  echo "[radar] If WORKER_URL/WORKER_KEY were previously inlined in run.sh, migrate them to /opt/fb-radar/radar.env (KEY=VALUE lines):" >&2
  echo '[radar]   WORKER_URL=https://facebook-supermarket-monitor.facebook-supermarket-monitor.workers.dev' >&2
  echo '[radar]   WORKER_KEY=<key>' >&2
fi

bash ./warp-preflight.sh || true

exec node ./radar-scraper.mjs
