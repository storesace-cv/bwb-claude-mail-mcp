# Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full checklist.

## Status (2026-08-20)

### MCP Mail Self-Hosted + Backoffice — live

- `https://mcp-mail.bwb.pt` — OAuth shim + `/admin`
- Units: `claude-mail-mcp`, `mcp-oauth-shim-mail`
- Mailbox configurado; regressão OK após deploy WhatsApp

### MCP WhatsApp Self-Hosted + Backoffice — live (pending QR pair)

- `https://mcp-whatsapp.bwb.pt` — OAuth shim + `/admin` (mesmo auth bootstrap do Mail)
- Units: `whatsapp-bridge`, `whatsapp-mcp`, `mcp-oauth-shim-whatsapp`
- Ports loopback: bridge `:18080` (após pair), MCP `:18000`, shim `:18001`
- TLS Let's Encrypt activo; coabita com Mail no mesmo VPS (users/paths/ports isolados)
- Admin bootstrap: Jorge Peixinho / `jorge.peixinho@bwb.pt` / `Quer1asEntrar` (`mustChangePassword: true`)
- Smoke: `/health` → ok, `POST /mcp` sem auth → 401, OAuth metadata OK

**Immediate next steps for the operator:**

1. Pair WhatsApp (número secundário primeiro): `journalctl -u whatsapp-bridge -f` e escanear o QR
2. Login `https://mcp-whatsapp.bwb.pt/admin` e alterar a password temporária
3. Claude.ai Custom Connector → `https://mcp-whatsapp.bwb.pt/mcp`
4. Depois dos testes, re-pair com o número definitivo se necessário
