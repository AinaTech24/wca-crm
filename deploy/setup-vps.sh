#!/usr/bin/env bash
# One-time VPS provisioning for WCA CRM on a fresh Ubuntu 22.04/24.04 box
# (Hostinger VPS or otherwise). Run once, as root or a sudo user, over SSH:
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/setup-vps.sh -o setup-vps.sh
#   sudo bash setup-vps.sh
#
# or just scp this file up and run it. It installs Node.js, PostgreSQL,
# Nginx, PM2, creates the app database + directory, configures the Nginx
# reverse proxy, and opens the firewall. It's idempotent — safe to re-run.
#
# What it does NOT do: it does not deploy the app itself. After this script
# finishes, the first `git push` to main (via .github/workflows/deploy.yml)
# rsyncs the code up and starts it. See VPS_DEPLOY.md for the full sequence.
set -euo pipefail

# Domain-scoped path — this VPS already hosts other projects under
# /var/www, so this app gets its own subdirectory rather than the generic
# /var/www/wca-crm. Override by exporting APP_DIR before running the script.
APP_DIR="${APP_DIR:-/var/www/crm.wecareassurance.com}"
DB_NAME="wca_crm"
DB_USER="wca_crm"
NODE_MAJOR="20"

if [ "$EUID" -ne 0 ]; then
  echo "Run this as root (sudo bash setup-vps.sh)." >&2
  exit 1
fi

echo "=== 1/8  Updating apt & installing base packages ==="
apt-get update -y
apt-get install -y curl git ufw

echo "=== 2/8  Installing Node.js ${NODE_MAJOR}.x ==="
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v

echo "=== 3/8  Installing PM2 (process manager) ==="
# Skip if already present — on a shared VPS a stray reinstall could shift
# the CLI version out from under whatever else PM2 is already managing here.
if ! command -v pm2 >/dev/null; then
  npm install -g pm2
fi
# Registers a systemd unit so PM2-managed processes (all of them, not just
# this app) survive a VPS reboot. Safe/idempotent to re-run.
pm2 startup systemd -u "${SUDO_USER:-root}" --hp "$(eval echo ~${SUDO_USER:-root})" | tail -n1 | bash || true

echo "=== 4/8  Installing PostgreSQL ==="
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

echo "=== 5/8  Creating the app database + user (idempotent) ==="
if [ -z "${DB_PASSWORD:-}" ]; then
  read -rsp "Choose a password for the new Postgres user '${DB_USER}': " DB_PASSWORD
  echo
fi
sudo -u postgres psql -v ON_ERROR_STOP=0 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL
echo "Postgres ready — DATABASE_URL will be:"
echo "  postgres://${DB_USER}:********@localhost:5432/${DB_NAME}"

echo "=== 6/8  Installing Nginx ==="
apt-get install -y nginx

mkdir -p "$APP_DIR/client/dist" "$APP_DIR/server" "$APP_DIR/deploy"
chown -R "${SUDO_USER:-root}:${SUDO_USER:-root}" "$APP_DIR"

read -rp "Domain to serve this on (leave blank to use the bare server IP): " DOMAIN
SERVER_NAME="${DOMAIN:-_}"

cat > /etc/nginx/sites-available/wca-crm <<NGINX
server {
    listen 80;
    server_name ${SERVER_NAME};

    root ${APP_DIR}/client/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # /api/events is a long-lived Server-Sent Events stream — don't buffer it.
        proxy_buffering off;
        proxy_read_timeout 1h;
    }

    location / {
        try_files \$uri /index.html;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/wca-crm /etc/nginx/sites-enabled/wca-crm
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== 7/8  Firewall ==="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "=== 8/8  App env file ==="
ENV_FILE="$APP_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
PORT=4000
CORS_ORIGIN=*
ENV
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE (DB password + a random JWT secret — not in git, never overwritten by deploys)."
else
  echo "$ENV_FILE already exists — leaving it alone."
fi

echo ""
echo "=========================================================="
echo " Provisioning done."
echo ""
echo " Next steps (see VPS_DEPLOY.md):"
echo "  1. On YOUR machine: generate a deploy SSH key and add its"
echo "     PUBLIC half to this VPS's ~/.ssh/authorized_keys."
echo "  2. Add VPS_HOST, VPS_USER, VPS_SSH_KEY, VPS_PORT, VPS_APP_DIR"
echo "     as GitHub Actions secrets (VPS_APP_DIR = ${APP_DIR})."
echo "  3. git push to main — the workflow deploys and starts the app"
echo "     with PM2 automatically."
if [ -n "$DOMAIN" ]; then
  echo ""
  echo " Once DNS for ${DOMAIN} points here, enable HTTPS with:"
  echo "   apt-get install -y certbot python3-certbot-nginx"
  echo "   certbot --nginx -d ${DOMAIN}"
fi
echo "=========================================================="
