#!/usr/bin/env bash
# Deploy bwb-comms on the same VPS as mail/whatsapp MCP.
# Does not restart Claude connector units.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SHIM_DIR="${SHIM_DIR:-/var/www/mcp-mail-shim}"
STATE_DIR="${STATE_DIR:-/var/lib/bwb-comms}"
MAIL_STATE="${MAIL_STATE:-/var/lib/mail-mcp}"
WA_STATE="${WA_STATE:-/var/lib/whatsapp-mcp}"
DOMAIN="${DOMAIN:-comms.bwb.pt}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-jorge.peixinho@bwb.pt}"

echo "==> User and directories"
id bwbcomms >/dev/null 2>&1 || useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin --comment "bwb-comms" bwbcomms
id mailmcp >/dev/null 2>&1 && usermod -aG mailmcp bwbcomms || true
id whatsappmcp >/dev/null 2>&1 && usermod -aG whatsappmcp bwbcomms || true
mkdir -p "$STATE_DIR/files/invoices"
chown -R bwbcomms:bwbcomms "$STATE_DIR"
chmod 700 "$STATE_DIR" "$STATE_DIR/files" "$STATE_DIR/files/invoices"

if [[ -f "$MAIL_STATE/accounts.json" ]]; then
  chmod 660 "$MAIL_STATE/accounts.json" || true
  chgrp mailmcp "$MAIL_STATE/accounts.json" || true
fi
if [[ -d "$WA_STATE/accounts" ]]; then
  chmod 750 "$WA_STATE/accounts" "$WA_STATE/accounts/a" "$WA_STATE/accounts/b" \
    "$WA_STATE/accounts/a/store" "$WA_STATE/accounts/b/store" 2>/dev/null || true
  chmod 640 "$WA_STATE/accounts/a/store/whatsapp.db" "$WA_STATE/accounts/b/store/whatsapp.db" 2>/dev/null || true
  chmod 640 "$WA_STATE/accounts/a/store/whatsapp.db-wal" "$WA_STATE/accounts/a/store/whatsapp.db-shm" 2>/dev/null || true
  chmod 640 "$WA_STATE/accounts/b/store/whatsapp.db-wal" "$WA_STATE/accounts/b/store/whatsapp.db-shm" 2>/dev/null || true
fi

echo "==> Sync app (same tree as mail shim)"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .env --exclude .git \
  --filter 'P .env' \
  "$REPO_ROOT/" "$SHIM_DIR/"
chown -R root:root "$SHIM_DIR"
if [[ -f "$SHIM_DIR/.env" ]]; then
  chgrp mailmcp "$SHIM_DIR/.env"
  chmod 640 "$SHIM_DIR/.env"
fi

echo "==> Build"
cd "$SHIM_DIR"
npm ci
npm run build

merge_env_key() {
  local key="$1"
  local val=""
  for src in "$SHIM_DIR/.env" "${BACKEND_DIR:-/var/www/mail-mcp}/.env"; do
    [[ -f "$src" ]] || continue
    val="$(grep -E "^${key}=" "$src" | head -1 | cut -d= -f2- || true)"
    [[ -n "$val" ]] && break
  done
  [[ -n "$val" ]] || return 0
  if grep -qE "^${key}=$" "$ENV_FILE" || grep -qE "^# ${key}=" "$ENV_FILE"; then
    sed -i "s|^# ${key}=.*|${key}=${val}|" "$ENV_FILE"
    sed -i "s|^${key}=$|${key}=${val}|" "$ENV_FILE"
  elif ! grep -qE "^${key}=" "$ENV_FILE"; then
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

ENV_FILE="$STATE_DIR/comms.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Creating comms.env"
  SESSION_SECRET="$(openssl rand -hex 32)"
  AUTH_TOKEN="$(openssl rand -hex 32)"
  cp "$REPO_ROOT/deploy/env/comms.env.example" "$ENV_FILE"
  sed -i "s/^COMMS_SESSION_SECRET=.*/COMMS_SESSION_SECRET=$SESSION_SECRET/" "$ENV_FILE"
  sed -i "s/^COMMS_AUTH_TOKEN=.*/COMMS_AUTH_TOKEN=$AUTH_TOKEN/" "$ENV_FILE"
fi
for key in MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET HELPDESK_CONTEXT_URL HELPDESK_CONTEXT_TOKEN; do
  merge_env_key "$key"
done
if ! grep -qE "^AGT_GROUP_JID=" "$ENV_FILE"; then
  echo "AGT_GROUP_JID=244928277927-1565965350@g.us" >> "$ENV_FILE"
fi
chown bwbcomms:bwbcomms "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "==> systemd"
cp "$REPO_ROOT/deploy/systemd/bwb-comms.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable bwb-comms.service
systemctl restart bwb-comms.service

echo "==> nginx"
cp "$REPO_ROOT/deploy/nginx/comms.bwb.pt.conf" /etc/nginx/sites-available/comms.bwb.pt.conf
ln -sfn /etc/nginx/sites-available/comms.bwb.pt.conf /etc/nginx/sites-enabled/comms.bwb.pt.conf

if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  cat > /etc/nginx/sites-available/comms.bwb.pt.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:3230;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
    }
    location = /health {
        proxy_pass http://127.0.0.1:3230/health;
        proxy_set_header Host \$host;
    }
}
EOF
  nginx -t
  systemctl reload nginx
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect; then
    cp "$REPO_ROOT/deploy/nginx/comms.bwb.pt.conf" /etc/nginx/sites-available/comms.bwb.pt.conf
    nginx -t
    systemctl reload nginx
  else
    echo "WARN: certbot failed (DNS $DOMAIN?). HTTP-only vhost left in place."
  fi
else
  nginx -t
  systemctl reload nginx
fi

echo "==> Status"
systemctl --no-pager --full status bwb-comms.service | sed -n '1,25p'
curl -fsS "http://127.0.0.1:3230/health" || true
echo
echo "Admin: https://$DOMAIN/admin  (change bootstrap password)"
echo "MCP read-only: https://$DOMAIN/mcp  (Bearer COMMS_AUTH_TOKEN in $ENV_FILE)"
