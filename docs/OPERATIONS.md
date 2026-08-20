# Operations

## Hosts

| Item | Value |
|------|--------|
| VPS | `178.159.34.165` / hostname `claude-mail-mcp` |
| SSH alias | `bwb-claude-mail-mcp` (`~/.ssh/digitalocean`) |

### MCP Mail

| Item | Value |
|------|--------|
| Public URL | `https://mcp-mail.bwb.pt` |
| Admin UI | `https://mcp-mail.bwb.pt/admin` |
| MCP URL (Claude) | `https://mcp-mail.bwb.pt/mcp` |

### MCP WhatsApp

| Item | Value |
|------|--------|
| Public URL | `https://mcp-whatsapp.bwb.pt` |
| Admin UI | `https://mcp-whatsapp.bwb.pt/admin` |
| MCP URL (Claude) | `https://mcp-whatsapp.bwb.pt/mcp` |

## Paths

| Path | Purpose |
|------|---------|
| `/var/www/mail-mcp` | Upstream `claude-mail-mcp` |
| `/var/www/mcp-mail-shim` | Mail OAuth shim + admin (`APP_MODE=mail`) |
| `/var/lib/mail-mcp/` | Mail state: `accounts.json`, `admin.json`, JWT keys, `token` |
| `/var/www/whatsapp-mcp` | Upstream `whatsapp-mcp` (bridge + Python MCP) |
| `/var/www/mcp-whatsapp-shim` | WhatsApp OAuth shim + admin (`APP_MODE=whatsapp`) |
| `/var/lib/whatsapp-mcp/` | WA state: `admin.json`, OAuth, `store/` (session + `.bridge-token`) |

## Services

```bash
# Mail
systemctl status claude-mail-mcp mcp-oauth-shim-mail nginx
journalctl -u claude-mail-mcp -f
journalctl -u mcp-oauth-shim-mail -f

# WhatsApp
systemctl status whatsapp-bridge whatsapp-mcp mcp-oauth-shim-whatsapp
journalctl -u whatsapp-bridge -f   # QR pairing appears here
journalctl -u whatsapp-mcp -f
journalctl -u mcp-oauth-shim-whatsapp -f
```

## Update

```bash
# Mail shim + upstream mail
bash deploy/install.sh

# WhatsApp stack (does not touch mail)
bash deploy/install-whatsapp.sh
```

## WhatsApp pairing

1. `journalctl -u whatsapp-bridge -f`
2. Scan QR: WhatsApp → Settings → Linked devices → Link a device
3. Prefer a secondary number first; REST API (`:18080`) starts only after a successful pair
4. Session persists in `/var/lib/whatsapp-mcp/store/whatsapp.db`

## Rotate AUTH_TOKEN (Mail)

```bash
NEW=$(openssl rand -hex 32)
echo -n "$NEW" > /var/lib/mail-mcp/token
chown mailmcp:mailmcp /var/lib/mail-mcp/token
chmod 600 /var/lib/mail-mcp/token
sed -i "s/^AUTH_TOKEN=.*/AUTH_TOKEN=$NEW/" /var/www/mail-mcp/.env
sed -i "s/^AUTH_TOKEN=.*/AUTH_TOKEN=$NEW/" /var/www/mcp-mail-shim/.env
systemctl restart claude-mail-mcp mcp-oauth-shim-mail
```

## Backup

Encrypt and back up:

- `/var/lib/mail-mcp/` (credentials + OAuth signing key)
- `/var/lib/whatsapp-mcp/` (admin, OAuth keys, WhatsApp session store)

Losing a JWT key only forces Claude to re-authorize that stack. Losing `whatsapp.db` requires a new QR pair.

## Safety

Prefer `move_message` to Trash over `delete_message` (irreversible).

WhatsApp: no bulk/broadcast; prefer DMs. Bridge is unofficial (whatsmeow) — Meta account risk is residual.
