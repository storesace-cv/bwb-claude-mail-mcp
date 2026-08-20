#!/usr/bin/env bash
# Deploy / update WhatsApp MCP stack on the same VPS as MCP Mail (cohabitation).
# Does NOT touch mail-mcp units, paths, or vhost.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
WA_DIR="${WA_DIR:-/var/www/whatsapp-mcp}"
SHIM_DIR="${SHIM_DIR:-/var/www/mcp-whatsapp-shim}"
STATE_DIR="${STATE_DIR:-/var/lib/whatsapp-mcp}"
DOMAIN="${DOMAIN:-mcp-whatsapp.bwb.pt}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-jorge.peixinho@bwb.pt}"

export PATH="/usr/local/go/bin:/usr/local/bin:$PATH"

echo "==> Ensuring user and directories"
id whatsappmcp >/dev/null 2>&1 || useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin --comment "whatsapp-mcp" whatsappmcp
mkdir -p "$STATE_DIR/store" "$STATE_DIR/outbox" "$STATE_DIR/oauth-state" \
  "$WA_DIR/bin" "$SHIM_DIR" /var/log/whatsapp-mcp /etc/whatsapp-mcp
chown -R whatsappmcp:whatsappmcp "$STATE_DIR" /var/log/whatsapp-mcp
chmod 700 "$STATE_DIR" "$STATE_DIR/store" "$STATE_DIR/outbox"

echo "==> Upstream whatsapp-mcp"
if [[ ! -d "$WA_DIR/.git" ]]; then
  rm -rf "$WA_DIR"
  git clone --depth 1 https://github.com/verygoodplugins/whatsapp-mcp.git "$WA_DIR"
fi
chown -R whatsappmcp:whatsappmcp "$WA_DIR"
rm -rf "$WA_DIR/whatsapp-bridge/store"
ln -sfn "$STATE_DIR/store" "$WA_DIR/whatsapp-bridge/store"
chown -h whatsappmcp:whatsappmcp "$WA_DIR/whatsapp-bridge/store"

echo "==> Build bridge"
sudo -u whatsappmcp env PATH="/usr/local/go/bin:$PATH" HOME="$STATE_DIR" \
  bash -lc "cd '$WA_DIR/whatsapp-bridge' && go build -o '$WA_DIR/bin/whatsapp-bridge' ."

echo "==> uv sync MCP"
sudo -u whatsappmcp env PATH="/usr/local/bin:$PATH" HOME="$STATE_DIR" \
  bash -lc "cd '$WA_DIR/whatsapp-mcp-server' && uv sync"

echo "==> Bridge / MCP env"
if [[ ! -f /etc/whatsapp-mcp/bridge.env ]]; then
  cp "$REPO_ROOT/deploy/env/whatsapp-bridge.env.example" /etc/whatsapp-mcp/bridge.env
  chgrp whatsappmcp /etc/whatsapp-mcp/bridge.env
  chmod 640 /etc/whatsapp-mcp/bridge.env
fi
if [[ ! -f /etc/whatsapp-mcp/mcp.env ]]; then
  cp "$REPO_ROOT/deploy/env/whatsapp-mcp.env.example" /etc/whatsapp-mcp/mcp.env
  chgrp whatsappmcp /etc/whatsapp-mcp/mcp.env
  chmod 640 /etc/whatsapp-mcp/mcp.env
fi

echo "==> Sync OAuth shim (APP_MODE=whatsapp)"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .env --exclude .git \
  --filter 'P .env' \
  "$REPO_ROOT/" "$SHIM_DIR/"
chown -R root:root "$SHIM_DIR"
if [[ -f "$SHIM_DIR/.env" ]]; then
  chgrp whatsappmcp "$SHIM_DIR/.env"
  chmod 640 "$SHIM_DIR/.env"
fi
chgrp whatsappmcp "$SHIM_DIR" || true
cd "$SHIM_DIR"
npm ci
npm run build

if [[ ! -f "$SHIM_DIR/.env" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  AUTH_TOKEN="$(openssl rand -hex 32)"
  cp "$REPO_ROOT/deploy/env/shim-whatsapp.env.example" "$SHIM_DIR/.env"
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" "$SHIM_DIR/.env"
  echo "AUTH_TOKEN=$AUTH_TOKEN" >> "$SHIM_DIR/.env"
  echo -n "$AUTH_TOKEN" > "$STATE_DIR/token"
  chown whatsappmcp:whatsappmcp "$STATE_DIR/token"
  chmod 600 "$STATE_DIR/token"
  chgrp whatsappmcp "$SHIM_DIR/.env"
  chmod 640 "$SHIM_DIR/.env"
else
  chgrp whatsappmcp "$SHIM_DIR/.env"
  chmod 640 "$SHIM_DIR/.env"
fi

echo "==> systemd units"
cp "$REPO_ROOT/deploy/systemd/whatsapp-bridge.service" /etc/systemd/system/
cp "$REPO_ROOT/deploy/systemd/whatsapp-mcp.service" /etc/systemd/system/
cp "$REPO_ROOT/deploy/systemd/mcp-oauth-shim-whatsapp.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable whatsapp-bridge.service whatsapp-mcp.service mcp-oauth-shim-whatsapp.service
systemctl restart whatsapp-bridge.service
sleep 2
# Inject bridge token into mcp.env after first start
if [[ -f "$STATE_DIR/store/.bridge-token" ]]; then
  chmod 600 "$STATE_DIR/store/.bridge-token"
  chown whatsappmcp:whatsappmcp "$STATE_DIR/store/.bridge-token"
  TOKEN="$(tr -d '\n' < "$STATE_DIR/store/.bridge-token")"
  if grep -q '^WHATSAPP_BRIDGE_TOKEN=' /etc/whatsapp-mcp/mcp.env; then
    sed -i "s|^WHATSAPP_BRIDGE_TOKEN=.*|WHATSAPP_BRIDGE_TOKEN=$TOKEN|" /etc/whatsapp-mcp/mcp.env
  else
    echo "WHATSAPP_BRIDGE_TOKEN=$TOKEN" >> /etc/whatsapp-mcp/mcp.env
  fi
fi
systemctl restart whatsapp-mcp.service
systemctl restart mcp-oauth-shim-whatsapp.service

echo "==> nginx (additive; mail vhost untouched)"
cp "$REPO_ROOT/deploy/nginx/mcp-whatsapp.bwb.pt.conf" /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf
# Prefer shim-health if MCP has no /health
sed -i 's|proxy_pass http://127.0.0.1:18000/health;|proxy_pass http://127.0.0.1:18001/shim-health;|' \
  /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf || true
ln -sfn /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf /etc/nginx/sites-enabled/mcp-whatsapp.bwb.pt.conf

if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  cat > /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:18001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
  # Restore hardened vhost after certbot
  cp "$REPO_ROOT/deploy/nginx/mcp-whatsapp.bwb.pt.conf" /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf
  sed -i 's|proxy_pass http://127.0.0.1:18000/health;|proxy_pass http://127.0.0.1:18001/shim-health;|' \
    /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf || true
fi

nginx -t
systemctl reload nginx

echo "==> Regression mail"
systemctl is-active claude-mail-mcp mcp-oauth-shim-mail
curl -fsS -o /dev/null -w "mail_health=%{http_code}\n" https://mcp-mail.bwb.pt/health || true
curl -fsS -o /dev/null -w "wa_shim=%{http_code}\n" "https://$DOMAIN/shim-health" || true

echo "==> Done. Pair WhatsApp via: journalctl -u whatsapp-bridge -f"
echo "    Admin: https://$DOMAIN/admin"
