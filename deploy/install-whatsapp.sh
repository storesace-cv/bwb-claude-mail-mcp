#!/usr/bin/env bash
# Deploy / update dual-account WhatsApp MCP (cohabits with Mail on same VPS).
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
mkdir -p \
  "$STATE_DIR/accounts/a/store" "$STATE_DIR/accounts/a/outbox" \
  "$STATE_DIR/accounts/b/store" "$STATE_DIR/accounts/b/outbox" \
  "$STATE_DIR/oauth-state" \
  "$WA_DIR/bin" "$WA_DIR/run/a" "$WA_DIR/run/b" \
  "$SHIM_DIR" /var/log/whatsapp-mcp \
  /etc/whatsapp-mcp/a /etc/whatsapp-mcp/b

# Migrate legacy single store → accounts/a (once)
if [[ -d "$STATE_DIR/store" ]] && [[ ! -f "$STATE_DIR/accounts/a/store/whatsapp.db" ]]; then
  echo "==> Migrating legacy store → accounts/a/store"
  shopt -s dotglob nullglob
  for f in "$STATE_DIR/store"/*; do
    [[ -e "$f" ]] || continue
    mv "$f" "$STATE_DIR/accounts/a/store/"
  done
  rmdir "$STATE_DIR/store" 2>/dev/null || true
fi

chown -R whatsappmcp:whatsappmcp "$STATE_DIR" /var/log/whatsapp-mcp
chmod 700 "$STATE_DIR" "$STATE_DIR/accounts/a/store" "$STATE_DIR/accounts/b/store"
chmod 700 "$STATE_DIR/accounts/a/outbox" "$STATE_DIR/accounts/b/outbox"

# Bridge run dirs: relative store/ symlink
ln -sfn "$STATE_DIR/accounts/a/store" "$WA_DIR/run/a/store"
ln -sfn "$STATE_DIR/accounts/b/store" "$WA_DIR/run/b/store"
chown -h whatsappmcp:whatsappmcp "$WA_DIR/run/a/store" "$WA_DIR/run/b/store"
chown whatsappmcp:whatsappmcp "$WA_DIR/run/a" "$WA_DIR/run/b"

if [[ ! -f "$STATE_DIR/wa-accounts.json" ]]; then
  cp "$REPO_ROOT/deploy/env/wa-accounts.json.example" "$STATE_DIR/wa-accounts.json"
  chown whatsappmcp:whatsappmcp "$STATE_DIR/wa-accounts.json"
  chmod 640 "$STATE_DIR/wa-accounts.json"
fi

echo "==> Upstream whatsapp-mcp"
if [[ ! -d "$WA_DIR/.git" ]]; then
  rm -rf "$WA_DIR"
  git clone --depth 1 https://github.com/verygoodplugins/whatsapp-mcp.git "$WA_DIR"
  mkdir -p "$WA_DIR/bin" "$WA_DIR/run/a" "$WA_DIR/run/b"
  ln -sfn "$STATE_DIR/accounts/a/store" "$WA_DIR/run/a/store"
  ln -sfn "$STATE_DIR/accounts/b/store" "$WA_DIR/run/b/store"
fi
chown -R whatsappmcp:whatsappmcp "$WA_DIR"

echo "==> Patch bridge (QR → store/qr.code for /admin)"
python3 "$REPO_ROOT/deploy/patches/patch-whatsapp-bridge-qr.py" "$WA_DIR/whatsapp-bridge/main.go"

echo "==> Build bridge"
sudo -u whatsappmcp env PATH="/usr/local/go/bin:$PATH" HOME="$STATE_DIR" \
  bash -lc "cd '$WA_DIR/whatsapp-bridge' && go build -o '$WA_DIR/bin/whatsapp-bridge' ."

echo "==> uv sync MCP"
sudo -u whatsappmcp env PATH="/usr/local/bin:$PATH" HOME="$STATE_DIR" \
  bash -lc "cd '$WA_DIR/whatsapp-mcp-server' && uv sync"

install_env() {
  local dest="$1" example="$2"
  if [[ ! -f "$dest" ]]; then
    cp "$example" "$dest"
  fi
  chgrp whatsappmcp "$dest"
  chmod 640 "$dest"
}

install_env /etc/whatsapp-mcp/a/bridge.env "$REPO_ROOT/deploy/env/whatsapp-bridge-a.env.example"
install_env /etc/whatsapp-mcp/b/bridge.env "$REPO_ROOT/deploy/env/whatsapp-bridge-b.env.example"
install_env /etc/whatsapp-mcp/a/mcp.env "$REPO_ROOT/deploy/env/whatsapp-mcp-a.env.example"
install_env /etc/whatsapp-mcp/b/mcp.env "$REPO_ROOT/deploy/env/whatsapp-mcp-b.env.example"

sync_bridge_token() {
  local slot="$1" store="$STATE_DIR/accounts/$1/store" mcp_env="/etc/whatsapp-mcp/$1/mcp.env"
  if [[ -f "$store/.bridge-token" ]]; then
    chmod 600 "$store/.bridge-token"
    chown whatsappmcp:whatsappmcp "$store/.bridge-token"
    local TOKEN
    TOKEN="$(tr -d '\n' < "$store/.bridge-token")"
    if grep -q '^WHATSAPP_BRIDGE_TOKEN=' "$mcp_env"; then
      sed -i "s|^WHATSAPP_BRIDGE_TOKEN=.*|WHATSAPP_BRIDGE_TOKEN=$TOKEN|" "$mcp_env"
    else
      echo "WHATSAPP_BRIDGE_TOKEN=$TOKEN" >> "$mcp_env"
    fi
  fi
}

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
# Point shim at accounts file
if ! grep -q '^WA_ACCOUNTS_FILE=' "$SHIM_DIR/.env"; then
  echo "WA_ACCOUNTS_FILE=$STATE_DIR/wa-accounts.json" >> "$SHIM_DIR/.env"
fi

echo "==> systemd units (dual accounts)"
# Stop legacy single-instance if present
systemctl stop whatsapp-bridge.service whatsapp-mcp.service 2>/dev/null || true
systemctl disable whatsapp-bridge.service whatsapp-mcp.service 2>/dev/null || true

cp "$REPO_ROOT/deploy/systemd/whatsapp-bridge-a.service" /etc/systemd/system/
cp "$REPO_ROOT/deploy/systemd/whatsapp-bridge-b.service" /etc/systemd/system/
cp "$REPO_ROOT/deploy/systemd/whatsapp-mcp-a.service" /etc/systemd/system/
cp "$REPO_ROOT/deploy/systemd/whatsapp-mcp-b.service" /etc/systemd/system/
cp "$REPO_ROOT/deploy/systemd/mcp-oauth-shim-whatsapp.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable whatsapp-bridge-a whatsapp-bridge-b whatsapp-mcp-a whatsapp-mcp-b mcp-oauth-shim-whatsapp

echo "==> sudoers for admin re-pair / logs"
install -m 440 "$REPO_ROOT/deploy/sudoers/whatsappmcp-admin" /etc/sudoers.d/whatsappmcp-admin
visudo -cf /etc/sudoers.d/whatsappmcp-admin
touch /var/log/whatsapp-mcp/bridge-a.log /var/log/whatsapp-mcp/bridge-b.log
chown whatsappmcp:whatsappmcp /var/log/whatsapp-mcp/bridge-a.log /var/log/whatsapp-mcp/bridge-b.log

systemctl restart whatsapp-bridge-a
sleep 2
sync_bridge_token a
systemctl restart whatsapp-mcp-a

systemctl restart whatsapp-bridge-b
sleep 2
sync_bridge_token b
systemctl restart whatsapp-mcp-b

systemctl restart mcp-oauth-shim-whatsapp

echo "==> nginx (additive; mail vhost untouched)"
cp "$REPO_ROOT/deploy/nginx/mcp-whatsapp.bwb.pt.conf" /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf
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
  cp "$REPO_ROOT/deploy/nginx/mcp-whatsapp.bwb.pt.conf" /etc/nginx/sites-available/mcp-whatsapp.bwb.pt.conf
fi

nginx -t
systemctl reload nginx

echo "==> Regression mail + smoke WA"
systemctl is-active claude-mail-mcp mcp-oauth-shim-mail whatsapp-bridge-a whatsapp-mcp-a whatsapp-bridge-b whatsapp-mcp-b mcp-oauth-shim-whatsapp
curl -fsS -o /dev/null -w "mail_health=%{http_code}\n" https://mcp-mail.bwb.pt/health || true
curl -fsS -o /dev/null -w "wa_shim=%{http_code}\n" "https://$DOMAIN/shim-health" || true
curl -s -o /dev/null -w "wa_a_mcp=%{http_code}\n" -X POST "https://$DOMAIN/a/mcp" || true
curl -s -o /dev/null -w "wa_b_mcp=%{http_code}\n" -X POST "https://$DOMAIN/b/mcp" || true

echo "==> Done. Admin: https://$DOMAIN/admin (2 cartões)"
echo "    Claude A: https://$DOMAIN/a/mcp"
echo "    Claude B: https://$DOMAIN/b/mcp"
