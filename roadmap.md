# Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full checklist.

## Status (2026-08-20)

### MCP Mail Self-Hosted + Backoffice — live

- `https://mcp-mail.bwb.pt` — OAuth shim + `/admin`
- Units: `claude-mail-mcp`, `mcp-oauth-shim-mail`

### MCP WhatsApp Self-Hosted + Backoffice — dual accounts live

- `https://mcp-whatsapp.bwb.pt/admin` — **2 cartões** (Pessoal `a` + Negócio `b`)
- Claude connectors:
  - Pessoal: `https://mcp-whatsapp.bwb.pt/a/mcp` (alias legado `/mcp` → `a`)
  - Negócio: `https://mcp-whatsapp.bwb.pt/b/mcp`
- Units: `whatsapp-bridge-a/b`, `whatsapp-mcp-a/b`, `mcp-oauth-shim-whatsapp`
- Stores: `/var/lib/whatsapp-mcp/accounts/{a,b}/store/`

**Operator next steps:**

1. Pair conta Negócio (`b`) via QR no admin (se ainda não associada)
2. Claude Desktop / Claude.ai: connector A = `/a/mcp`, connector B = `/b/mcp`
3. Encrypted backup de `/var/lib/whatsapp-mcp/accounts/`
