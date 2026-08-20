# Roadmap

## Done (2026-08-20)

- [x] VPS Ubuntu 24.04 hardened (SSH key-only, UFW, fail2ban, unattended-upgrades)
- [x] DNS `mcp-mail.bwb.pt` → `178.159.34.165`
- [x] Deploy upstream `claude-mail-mcp` v0.2.1 on `:3220` (loopback)
- [x] Custom OAuth 2.1 + DCR + PKCE shim on `:3221` (loopback)
- [x] Admin backoffice at `/admin` (multi-account CRUD, profile, force password change)
- [x] nginx + Let's Encrypt for `https://mcp-mail.bwb.pt`
- [x] systemd hardening for both services
- [x] Repo `storesace-cv/bwb-claude-mail-mcp` with deploy scripts

## Next

- [ ] Add first real mailbox (`jorge.peixinho@bwb.pt`) via `/admin` and validate IMAP tools in Claude.ai
- [ ] Connect Claude.ai Custom Connector and complete OAuth once
- [ ] Optional CalDAV for calendar tools
- [ ] Encrypted off-host backup of `/var/lib/mail-mcp/`
- [ ] AUTH_TOKEN rotation schedule (90 days)
- [ ] Optional egress allowlist (PTISP mail IPs) on systemd unit

## Out of scope (for now)

- Multi-admin / multi-tenant
- At-rest encryption of `accounts.json` beyond filesystem perms
- Attachment download as base64 (upstream roadmap)
