#!/usr/bin/env bash
# Build and (re)start Reckon under pm2.
#
# Run from the project root on the deploy host:
#   scripts/deploy.sh
#
# First-time setup on the host:
#   1. Install Node 20+ and pnpm (corepack enable && corepack prepare pnpm@latest --activate)
#   2. Install pm2 globally:        pnpm add -g pm2
#   3. Wire pm2 into systemd:       pm2 startup    # then run the printed sudo command
#   4. Copy .env.example to .env.production and fill it in
#   5. Run this script

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "error: .env.production not found in $(pwd)" >&2
  echo "       copy .env.example and fill in the values." >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "error: pm2 not on PATH. Install with: pnpm add -g pm2" >&2
  exit 1
fi

# Pull latest, then re-exec the (possibly updated) script. Without this, bash
# continues reading from the file descriptor that pointed to the pre-pull
# inode of this file and silently skips any lines added by the pull — so a
# fresh `pnpm doctor` step (or any other addition below `git pull`) won't
# run on the very deploy that pulls it in.
git pull --ff-only
if [ "${RECKON_DEPLOY_REEXEC:-}" != "1" ]; then
  export RECKON_DEPLOY_REEXEC=1
  exec "$0" "$@"
fi

pnpm install --frozen-lockfile
pnpm build

# Surface missing skill dependencies (Python libs, LibreOffice, etc.) so the
# deploy log makes it obvious what to install. Non-blocking — the app still
# starts; the affected skills just won't work end-to-end until deps are added.
pnpm doctor || true

# Make sure the SQLite directory exists before the app starts.
mkdir -p data

# Load .env.production into this shell so pm2 inherits it when it spawns
# `next start`. Next.js also auto-loads .env.production at runtime, but
# sourcing here covers vars read outside of Next's loader (e.g. by
# instrumentation).
set -a
# shellcheck disable=SC1091
. ./.env.production
set +a

# Idempotent: starts on first run, reloads (zero-downtime) thereafter.
pm2 startOrReload ecosystem.config.cjs --update-env

# Persist the process list so `pm2 resurrect` (run by the systemd unit that
# `pm2 startup` installed) restores Reckon after a reboot.
pm2 save

echo
pm2 status reckon
echo
echo "Logs: pm2 logs reckon"
