# Operations

## Hosts

| Item | Value |
|------|--------|
| VPS | `178.159.34.165` / hostname `claude-mail-mcp` |
| SSH alias | `bwb-claude-mail-mcp` (`~/.ssh/digitalocean`) |

### MCP Mail

| Item | Value |
|------|--------|
| Public URL | `https://mcp-mail.bwb.pt` |
| Admin UI | `https://mcp-mail.bwb.pt/admin` |
| MCP URL | `https://mcp-mail.bwb.pt/mcp` |

### MCP WhatsApp (dual accounts)

| Item | Value |
|------|--------|
| Public URL | `https://mcp-whatsapp.bwb.pt` |
| Admin UI | `https://mcp-whatsapp.bwb.pt/admin` (2 cartões) |
| MCP Pessoal (`a`) | `https://mcp-whatsapp.bwb.pt/a/mcp` |
| MCP Negócio (`b`) | `https://mcp-whatsapp.bwb.pt/b/mcp` |
| Alias legado | `/mcp` → conta `a` |

## Paths

| Path | Purpose |
|------|---------|
| `/var/www/mail-mcp` | Upstream `claude-mail-mcp` |
| `/var/www/mcp-mail-shim` | Mail OAuth shim |
| `/var/lib/mail-mcp/` | Mail state |
| `/var/www/whatsapp-mcp` | Upstream whatsapp-mcp + `bin/` + `run/{a,b}/` |
| `/var/www/mcp-whatsapp-shim` | WhatsApp OAuth shim + admin |
| `/var/lib/whatsapp-mcp/accounts/a/store/` | Sessão Pessoal |
| `/var/lib/whatsapp-mcp/accounts/b/store/` | Sessão Negócio |
| `/var/lib/whatsapp-mcp/wa-accounts.json` | Labels/ports das contas |
| `/etc/whatsapp-mcp/{a,b}/` | Env bridge + MCP por conta |

### Helpdesk ticket context

| Variable (backend `.env`) | Purpose |
|------|---------|
| `HELPDESK_CONTEXT_URL` | `https://helpdesk.storesace.cv/otobo/public.pl?Action=PublicBWBTicketContext` |
| `HELPDESK_CONTEXT_TOKEN` | Same Bearer as OTOBO `ZZZBWBTicketContext.pm` |

After changing `.env`: `systemctl restart claude-mail-mcp.service`. Docs: `HANDOFF-IMPLEMENTACAO-HELPDECK-CONTEXT.md`, `CLAUDE-AI-HELPDECK-EMAIL.md`.

Tools BWB no backend patched: `helpdesk_ticket_context`, `create_folder`, `copy_message`, `rename_folder`, `delete_folder`, `mark_flagged`, `folder_status`, `get_attachment`, `update_event`, `delete_event` (além das tools mail/calendar do upstream).

### Contas Mail — fornecedores e OAuth

Na admin (`/admin/accounts/new`) escolhe o tipo:

| Tipo | Auth |
|------|------|
| Servidor normal | user + password |
| Outlook.com / Hotmail (pessoal) | OAuth2 («Ligar com Microsoft») |
| Gmail (pessoal) | OAuth2 («Ligar com Google») |
| iCloud | senha de aplicação Apple |

Redirect URIs a registar nas consoles:

- `https://mcp-mail.bwb.pt/admin/oauth/microsoft/callback`
- `https://mcp-mail.bwb.pt/admin/oauth/google/callback`

Env (shim **e** backend `claude-mail-mcp`):

```bash
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

**Microsoft Entra:** app «Accounts in any personal Microsoft account only»; scopes delegados `IMAP.AccessAsUser.All`, `SMTP.Send` (+ `offline_access` no authorize). Authorize via tenant `consumers`.

**Google Cloud:** OAuth client Web; scope `https://mail.google.com/`; consent External (test users ou production).

Depois de alterar `.env`: `systemctl restart mcp-oauth-shim-mail claude-mail-mcp`.

## Services

```bash
# Mail
systemctl status claude-mail-mcp mcp-oauth-shim-mail

# WhatsApp dual
systemctl status whatsapp-bridge-a whatsapp-mcp-a whatsapp-bridge-b whatsapp-mcp-b mcp-oauth-shim-whatsapp
journalctl -u whatsapp-bridge-a -f
journalctl -u whatsapp-bridge-b -f
```

## Update

```bash
bash deploy/install.sh              # Mail
bash deploy/install-whatsapp.sh     # WhatsApp dual (migra store legado se preciso)
```

## Pairing

1. Abrir `https://mcp-whatsapp.bwb.pt/admin`
2. Escaneiar o QR do cartão correspondente
3. Re-pair de uma conta: apagar `accounts/{id}/store/whatsapp.db` e `systemctl restart whatsapp-bridge-{id}`

## Claude Desktop

- Pessoal: `mcp-remote` → `https://mcp-whatsapp.bwb.pt/a/mcp` + Bearer `AUTH_TOKEN`
- Negócio: segundo server → `https://mcp-whatsapp.bwb.pt/b/mcp` + mesmo Bearer

## Backup

- `/var/lib/mail-mcp/`
- `/var/lib/whatsapp-mcp/` (admin, OAuth keys, `accounts/*/store`)

## Safety

Prefer `move_message` to Trash over `delete_message`. WhatsApp bridge is unofficial (whatsmeow) — residual Meta account risk.
