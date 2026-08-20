#!/usr/bin/env bash
# Deploy / update bwb-claude-mail-mcp (shim) + upstream claude-mail-mcp on the VPS.
# Run as root on the server, from a checkout of this repo OR after rsync.
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SHIM_DIR="${SHIM_DIR:-/var/www/mcp-mail-shim}"
BACKEND_DIR="${BACKEND_DIR:-/var/www/mail-mcp}"
STATE_DIR="${STATE_DIR:-/var/lib/mail-mcp}"
DOMAIN="${DOMAIN:-mcp-mail.bwb.pt}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-jorge.peixinho@bwb.pt}"

echo "==> Ensuring directories and user"
id mailmcp >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --comment "claude-mail-mcp" mailmcp
mkdir -p "$STATE_DIR/oauth-state" "$SHIM_DIR" "$BACKEND_DIR"
chown -R mailmcp:mailmcp "$STATE_DIR"
chmod 700 "$STATE_DIR" "$STATE_DIR/oauth-state"

echo "==> Sync shim from repo"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .env --exclude .git \
  --filter 'P .env' \
  "$REPO_ROOT/" "$SHIM_DIR/"
chown -R root:root "$SHIM_DIR"
# Keep .env readable by the service user after chown -R
if [[ -f "$SHIM_DIR/.env" ]]; then
  chgrp mailmcp "$SHIM_DIR/.env"
  chmod 640 "$SHIM_DIR/.env"
fi
chgrp mailmcp "$SHIM_DIR"

echo "==> Build shim"
cd "$SHIM_DIR"
npm ci
npm run build

if [[ ! -f "$SHIM_DIR/.env" ]]; then
  echo "==> Creating shim .env"
  AUTH_TOKEN="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  cp "$REPO_ROOT/deploy/env/shim.env.example" "$SHIM_DIR/.env"
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" "$SHIM_DIR/.env"
  echo "AUTH_TOKEN=$AUTH_TOKEN" >> "$SHIM_DIR/.env"
  echo -n "$AUTH_TOKEN" > "$STATE_DIR/token"
  chown mailmcp:mailmcp "$STATE_DIR/token"
  chmod 600 "$STATE_DIR/token"
  chgrp mailmcp "$SHIM_DIR/.env"
  chmod 640 "$SHIM_DIR/.env"
else
  AUTH_TOKEN="$(grep -E '^AUTH_TOKEN=' "$SHIM_DIR/.env" | head -1 | cut -d= -f2-)"
  if [[ -n "$AUTH_TOKEN" ]]; then
    echo -n "$AUTH_TOKEN" > "$STATE_DIR/token"
    chown mailmcp:mailmcp "$STATE_DIR/token"
    chmod 600 "$STATE_DIR/token"
  fi
fi

echo "==> Upstream claude-mail-mcp"
if [[ ! -d "$BACKEND_DIR/.git" ]]; then
  git clone https://github.com/maxx3250/claude-mail-mcp.git "$BACKEND_DIR"
fi
cd "$BACKEND_DIR"
git fetch --tags
git checkout v0.2.1 2>/dev/null || git checkout main
npm ci
npm run build

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  cp "$REPO_ROOT/deploy/env/backend.env.example" "$BACKEND_DIR/.env"
  TOKEN="$(cat "$STATE_DIR/token")"
  sed -i "s/^AUTH_TOKEN=.*/AUTH_TOKEN=$TOKEN/" "$BACKEND_DIR/.env"
  chgrp mailmcp "$BACKEND_DIR/.env"
  chmod 640 "$BACKEND_DIR/.env"
fi

# Ensure accounts file exists
if [[ ! -f "$STATE_DIR/accounts.json" ]]; then
  echo '{"version":1,"accounts":[]}' > "$STATE_DIR/accounts.json"
  chown mailmcp:mailmcp "$STATE_DIR/accounts.json"
  chmod 600 "$STATE_DIR/accounts.json"
fi

echo "==> systemd units"
cp "$REPO_ROOT/deploy/systemd/claude-mail-mcp.service" /etc/systemd/system/
cp "$REPO_ROOT/deploy/systemd/mcp-oauth-shim-mail.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable claude-mail-mcp.service mcp-oauth-shim-mail.service
systemctl restart claude-mail-mcp.service
systemctl restart mcp-oauth-shim-mail.service

echo "==> nginx"
cp "$REPO_ROOT/deploy/nginx/mcp-mail.bwb.pt.conf" /etc/nginx/sites-available/mcp-mail.bwb.pt.conf
ln -sfn /etc/nginx/sites-available/mcp-mail.bwb.pt.conf /etc/nginx/sites-enabled/mcp-mail.bwb.pt.conf
rm -f /etc/nginx/sites-enabled/default

# Bootstrap HTTP-only vhost if certs not yet present
if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  cat > /etc/nginx/sites-available/mcp-mail.bwb.pt.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:3221;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
    }
    location = /health {
        proxy_pass http://127.0.0.1:3220/health;
        proxy_set_header Host \$host;
    }
}
EOF
  nginx -t
  systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
  # Restore hardened SSL config and re-run certbot install if needed
  cp "$REPO_ROOT/deploy/nginx/mcp-mail.bwb.pt.conf" /etc/nginx/sites-available/mcp-mail.bwb.pt.conf
  nginx -t
  systemctl reload nginx
else
  nginx -t
  systemctl reload nginx
fi

if [[ -f "$REPO_ROOT/deploy/fail2ban/mcp-oauth-shim.conf" ]]; then
  cp "$REPO_ROOT/deploy/fail2ban/mcp-oauth-shim.conf" /etc/fail2ban/filter.d/mcp-oauth-shim.conf
  if ! grep -q '\[mcp-oauth-shim\]' /etc/fail2ban/jail.local 2>/dev/null; then
    cat >> /etc/fail2ban/jail.local <<'EOF'

[mcp-oauth-shim]
enabled = true
filter = mcp-oauth-shim
backend = systemd
maxretry = 5
findtime = 600
bantime = 3600
EOF
  fi
  systemctl reload fail2ban || true
fi

echo "==> Status"
systemctl --no-pager --full status claude-mail-mcp.service mcp-oauth-shim-mail.service | sed -n '1,40p'
curl -fsS "http://127.0.0.1:3220/health" || true
echo
curl -fsS "http://127.0.0.1:3221/shim-health" || true
echo
echo "Deploy done. Admin: https://$DOMAIN/admin"
