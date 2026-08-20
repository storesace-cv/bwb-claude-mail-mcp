# Roadmap

## Done (2026-08-20)

### MCP Mail

- [x] VPS Ubuntu 24.04 hardened; DNS `mcp-mail.bwb.pt`
- [x] `claude-mail-mcp` + OAuth shim + `/admin`
- [x] nginx + Let's Encrypt; smoke tests

### MCP WhatsApp (cohabitation)

- [x] DNS `mcp-whatsapp.bwb.pt`; Go + uv; user `whatsappmcp`
- [x] OAuth shim + `/admin` with QR pairing
- [x] Streamable HTTP session header proxy fix (Claude Desktop)
- [x] **Dual accounts**: slots `a` (Pessoal) + `b` (Negócio), 2 cartões no admin, connectors `/a/mcp` + `/b/mcp`
- [x] Migração store legado → `accounts/a/store`

## Next

- [ ] Pair / validate conta Negócio (`b`) se ainda sem sessão
- [ ] Claude Desktop: `bwb-whatsapp` → `/a/mcp`; adicionar `bwb-whatsapp-negocio` → `/b/mcp`
- [ ] Encrypted off-host backup of `/var/lib/mail-mcp/` and `/var/lib/whatsapp-mcp/accounts/`
- [ ] AUTH_TOKEN rotation schedule (90 days)

## Out of scope (for now)

- Dynamic N accounts CRUD beyond fixed a/b
- Single Claude connector that switches accounts
- WhatsApp webhooks / bulk messaging
