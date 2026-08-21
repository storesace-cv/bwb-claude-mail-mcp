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

## Done (2026-08-21)

### Helpdesk email context

- [x] Patches `mail-v0.2.1`: `get_message` → `bwb` + `headersRelevant`; tool `helpdesk_ticket_context`
- [x] Docs: `HANDOFF-IMPLEMENTACAO-HELPDECK-CONTEXT.md`, `CLAUDE-AI-HELPDECK-EMAIL.md`
- [x] OTOBO counterpart: `X-BWB-*` + `PublicBWBTicketContext` (repo `bwb-otobo-custom`)

## Next

- [ ] Pair / validate conta Negócio (`b`) se ainda sem sessão
- [ ] Claude Desktop: `bwb-whatsapp` → `/a/mcp`; adicionar `bwb-whatsapp-negocio` → `/b/mcp`
- [ ] Encrypted off-host backup of `/var/lib/mail-mcp/` and `/var/lib/whatsapp-mcp/accounts/`
- [ ] AUTH_TOKEN rotation schedule (90 days)
- [ ] Configure `HELPDESK_CONTEXT_*` + OTOBO `ZZZBWBTicketContext.pm` in production and e2e test

## Out of scope (for now)

- Dynamic N accounts CRUD beyond fixed a/b
- Single Claude connector that switches accounts
- WhatsApp webhooks / bulk messaging
- IMAP on PostMaster intake mailboxes
