#!/usr/bin/env bash
#
# Manual deploy to the VPS — the same steps the GitHub Actions workflow runs,
# for when Actions can't (billing, or you just want to ship without pushing).
#
# Run from the repo root in Git Bash:
#     bash deploy/manual-deploy.sh
#
# Windows Git Bash has no rsync, so files go over as a tar stream through ssh.
# Two things are never touched on the server: server/.env (your database URL,
# SMTP password and JWT secret) and server/node_modules.

set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh_deploy_keys/wca_crm_deploy_key}"
HOST="${HOST:-root@crm.wecareassurance.com}"
APP="${APP:-/var/www/crm.wecareassurance.com}"
PM2_NAME="${PM2_NAME:-wca-crm-api}"
SITE="${SITE:-https://crm.wecareassurance.com}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ssh_run() { ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$HOST" "$@"; }

[ -d client ] && [ -d server ] || { echo "Run this from the repo root (the folder containing client/ and server/)."; exit 1; }
[ -f "$SSH_KEY" ] || { echo "SSH key not found at: $SSH_KEY"; exit 1; }

say "Building the client"
npm --prefix client run build

say "Checking the server parses before shipping it"
for f in server/*.js; do node --check "$f"; done

say "Shipping the client build"
# The bundle filename changes every build, so old assets are cleared first —
# otherwise the folder accumulates every build ever deployed.
tar czf - -C client/dist . | ssh_run "rm -rf '$APP/client/dist/assets' && tar xzf - -C '$APP/client/dist'"

say "Shipping the server source"
tar czf - --exclude=node_modules --exclude=.env -C server . \
  | ssh_run "tar xzf - -C '$APP/server'"

say "Installing server dependencies if they changed"
ssh_run "cd '$APP/server' && npm ci --omit=dev >/dev/null 2>&1 || npm install --omit=dev >/dev/null 2>&1; echo '    done'"

say "Restarting the API"
ssh_run "pm2 restart '$PM2_NAME' --update-env >/dev/null 2>&1 && pm2 save >/dev/null 2>&1; echo '    restarted'"

say "Verifying"
sleep 8
# Listening on the port is the check that matters: the process can be "online"
# in PM2 while never having bound, which looks healthy and serves nothing.
if ssh_run "ss -ltn 2>/dev/null | grep -q ':4000'"; then
  echo "    port 4000: listening"
else
  echo "    port 4000: NOT LISTENING — check 'pm2 logs $PM2_NAME --err'"; exit 1
fi
echo "    health   : $(curl -s --max-time 10 "$SITE/api/health" || echo 'no response')"
echo "    site     : HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/")"

say "Deployed"
