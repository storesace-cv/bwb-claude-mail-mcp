# Roadmap

## Done (2026-08-20)

### MCP Mail

- [x] VPS Ubuntu 24.04 hardened (SSH key-only, UFW, fail2ban, unattended-upgrades)
- [x] DNS `mcp-mail.bwb.pt` → `178.159.34.165`
- [x] Deploy upstream `claude-mail-mcp` v0.2.1 on `:3220` (loopback)
- [x] Custom OAuth 2.1 + DCR + PKCE shim on `:3221` (loopback)
- [x] Admin backoffice at `/admin` (multi-account CRUD, profile, force password change)
- [x] nginx + Let's Encrypt for `https://mcp-mail.bwb.pt`
- [x] systemd units (Protect* hardening; SystemCallFilter relaxed for Node on 24.04)
- [x] Repo `storesace-cv/bwb-claude-mail-mcp` with deploy scripts
- [x] Smoke tests: `/health`, `/mcp` 401, OAuth metadata, admin bootstrap

### MCP WhatsApp (cohabitation on same VPS)

- [x] DNS `mcp-whatsapp.bwb.pt` → `178.159.34.165`
- [x] Go 1.27 + uv + ffmpeg; system user `whatsappmcp`
- [x] Upstream `verygoodplugins/whatsapp-mcp` bridge + Python MCP HTTP
- [x] OAuth shim `APP_MODE=whatsapp` on `:18001` + `/admin` (same auth bootstrap as Mail)
- [x] systemd: `whatsapp-bridge`, `whatsapp-mcp`, `mcp-oauth-shim-whatsapp`
- [x] nginx + Let's Encrypt for `https://mcp-whatsapp.bwb.pt` (mail vhost untouched)
- [x] Smoke: `/health`, `/mcp` 401, OAuth metadata; mail regression OK
- [x] Deploy script `deploy/install-whatsapp.sh`

## Next

- [ ] Scan WhatsApp QR (`journalctl -u whatsapp-bridge -f`) with secondary number, then validate tools
- [ ] Change WhatsApp admin password at `https://mcp-whatsapp.bwb.pt/admin`
- [ ] Connect Claude.ai Custom Connector → `https://mcp-whatsapp.bwb.pt/mcp`
- [ ] Re-pair with production number after secondary tests
- [ ] Encrypted off-host backup of `/var/lib/mail-mcp/` and `/var/lib/whatsapp-mcp/store/`
- [ ] AUTH_TOKEN rotation schedule (90 days)
- [ ] Optional egress allowlist on systemd units

## Out of scope (for now)

- Multi-admin / multi-tenant
- WhatsApp webhooks (`WEBHOOK_ENABLED=false`)
- Bulk/broadcast messaging
- At-rest encryption of secrets beyond filesystem perms
