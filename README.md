# MCP Mail · bwb.pt

Self-hosted [claude-mail-mcp](https://github.com/maxx3250/claude-mail-mcp) connector for Claude.ai, with:

- **OAuth 2.1 + DCR + PKCE shim** (Claude.ai Custom Connector)
- **Backoffice** at `https://mcp-mail.bwb.pt/admin` for multi-account IMAP/SMTP management
- **BWB Comms** at `https://comms.bwb.pt/admin` — ingest autónomo (unanswered, facturas, WhatsApp allowlist, KB). Deploy: `bash deploy/install-comms.sh`
- Hardened nginx + systemd on Ubuntu 24.04

## Architecture

```
Claude.ai ──HTTPS/OAuth──▶ nginx (mcp-mail.bwb.pt)
                              ├─ /health  → claude-mail-mcp :3220
                              └─ /*       → oauth-shim+admin :3221 ──Bearer──▶ :3220
```

## Local development

```bash
cp deploy/env/shim.env.example .env
# adjust STATE_DIR to a local path, SESSION_SECRET, AUTH_TOKEN
npm install
npm run build
npm start
```

## Production deploy

On the VPS (as root), from this repo checkout:

```bash
bash deploy/install.sh
```

Then open `https://mcp-mail.bwb.pt/admin`, login, **change the temporary password**, add mailbox accounts.

Claude.ai → Settings → Connectors → Add custom → URL `https://mcp-mail.bwb.pt/mcp`.

## Ops

See [docs/OPERATIONS.md](docs/OPERATIONS.md) and [docs/ROADMAP.md](docs/ROADMAP.md).
