# Operations

## Hosts

| Item | Value |
|------|--------|
| VPS | `178.159.34.165` / hostname `claude-mail-mcp` |
| SSH alias | `bwb-claude-mail-mcp` (`~/.ssh/digitalocean`) |
| Public URL | `https://mcp-mail.bwb.pt` |
| Admin UI | `https://mcp-mail.bwb.pt/admin` |
| MCP URL (Claude) | `https://mcp-mail.bwb.pt/mcp` |

## Paths

| Path | Purpose |
|------|---------|
| `/var/www/mail-mcp` | Upstream `claude-mail-mcp` |
| `/var/www/mcp-mail-shim` | This repo (OAuth shim + admin) |
| `/var/lib/mail-mcp/` | State: `accounts.json`, `admin.json`, JWT keys, `token` |

## Services

```bash
systemctl status claude-mail-mcp mcp-oauth-shim-mail nginx
journalctl -u claude-mail-mcp -f
journalctl -u mcp-oauth-shim-mail -f
```

## Update

```bash
cd /path/to/bwb-claude-mail-mcp   # or git pull on server checkout
bash deploy/install.sh
```

## Rotate AUTH_TOKEN

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

Encrypt and back up `/var/lib/mail-mcp/` (credentials + OAuth signing key). Losing the JWT key only forces Claude to re-authorize.

## Safety

Prefer `move_message` to Trash over `delete_message` (irreversible).
