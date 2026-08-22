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
- [x] **Dual accounts**: slots `a` (Pessoal) + `b` (Angola), 2 cartões no admin, connectors `/a/mcp` + `/b/mcp`
- [x] Migração store legado → `accounts/a/store`
- [x] Admin self-serve: rename, re-pair, logs copy/download (sem SSH)

## Done (2026-08-21)

### Helpdesk email context + mail completeness

- [x] Patches `mail-v0.2.1`: `get_message` → `bwb` + `headersRelevant`; tool `helpdesk_ticket_context`
- [x] Tool `create_folder` (CREATE + SUBSCRIBE)
- [x] Tools: `copy_message`, `rename_folder`, `delete_folder`, `mark_flagged`, `folder_status`, `get_attachment`
- [x] Calendar: `update_event`, `delete_event` (requerem CalDAV na conta)
- [x] Docs: `HANDOFF-IMPLEMENTACAO-HELPDECK-CONTEXT.md`, `CLAUDE-AI-HELPDECK-EMAIL.md`
- [x] OTOBO: `X-BWB-*` + `PublicBWBTicketContext` + token files

### Mail provider OAuth + presets

- [x] Tipo de conta na admin: genérico / Microsoft pessoal / Gmail pessoal / iCloud
- [x] OAuth2 XOAUTH2 Outlook.com (tenant `consumers`) + Gmail pessoal
- [x] iCloud: preset hosts + senha de aplicação
- [x] Patch upstream: parse oauth, ImapFlow/nodemailer accessToken, refresh tokens
- [x] Docs ops: registo Azure/Google + env `MICROSOFT_*` / `GOOGLE_*`

## Done (2026-08-22)

### BWB Comms (autónomo, sem API OpenAI)

- [x] Serviço `bwb-comms` no mesmo VPS (`comms.bwb.pt`): jobs IMAP + SQLite + UI admin
- [x] Unanswered por thread, digest SMTP, regras de pasta (move IMAP nosso)
- [x] Facturas: anexos PDF/imagem → disco + texto PDF local
- [x] WhatsApp: allowlist + sync read-only `whatsapp.db` a/b
- [x] KB drafts manuais + pack Markdown `/admin/pack.md` para ChatGPT Pro
- [x] MCP read-only `POST /mcp` (Bearer) — sem writes
- [x] Deploy: `deploy/install-comms.sh` (não reinicia conectores Claude)

## Next

- [ ] DNS `A comms.bwb.pt` → VPS (se ainda não existir)
- [ ] Registar apps Azure (pessoal) + Google Cloud e preencher secrets no VPS
- [ ] Smoke: ligar conta Outlook.com + Gmail reais na admin
- [ ] Encrypted off-host backup of `/var/lib/mail-mcp/` and `/var/lib/whatsapp-mcp/accounts/`
- [ ] AUTH_TOKEN rotation schedule (90 days)
- [ ] Assistente Claude config na admin (cola JSON → merge connectors)
- [ ] Opcional: CalDAV na conta `bwb-pessoal`; `list_threads` / search multi-pasta (upstream v0.3+)

## Out of scope (for now)

- Microsoft 365 trabalho/escola (tenant) / Google Workspace empresarial
- Dynamic N accounts CRUD beyond fixed a/b (WhatsApp)
- Single Claude connector that switches accounts
- WhatsApp webhooks / bulk messaging
- IMAP on PostMaster intake mailboxes
- CardDAV contacts / JMAP
