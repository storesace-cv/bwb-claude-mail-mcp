# Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full checklist.

## Status (2026-08-20)

Self-hosted MCP Mail is **live** at `https://mcp-mail.bwb.pt` with OAuth shim + `/admin` backoffice.

Verified:

- `GET /health` → ok (claude-mail-mcp 0.2.1)
- `POST /mcp` sem auth → 401
- OAuth metadata em `/.well-known/oauth-authorization-server`
- Admin bootstrap: Jorge Peixinho / `jorge.peixinho@bwb.pt` (`mustChangePassword: true`)
- TLS Let's Encrypt activo; fail2ban jail `mcp-oauth-shim` activo

**Immediate next steps for the operator:**

1. Login at `https://mcp-mail.bwb.pt/admin` and change the temporary password
2. Add IMAP/SMTP account(s) (e.g. `mail.bwb.pt:993` / `:465`)
3. Add Custom Connector in Claude.ai → `https://mcp-mail.bwb.pt/mcp`
