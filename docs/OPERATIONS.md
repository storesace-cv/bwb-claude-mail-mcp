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

### Contas Mail — fornecedores (GUI)

Na admin (`/admin/accounts/new` ou editar conta):

| Tipo | O que colar |
|------|-------------|
| Servidor normal | user + password do servidor |
| Outlook.com / Hotmail | email + **senha de aplicação** Microsoft |
| Gmail | email + **senha de aplicação** Google |
| iCloud | email + **senha de aplicação** Apple |

Fluxo típico Outlook: cria senha em [account.live.com/proofs/AppPassword](https://account.live.com/proofs/AppPassword) → cola nos campos da admin → Testar → Guardar. Hosts/portas vêm do preset (IMAP 993, SMTP 587).

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

## BWB Comms (ingest autónomo)

| Item | Value |
|------|--------|
| Public URL | `https://comms.bwb.pt` |
| Admin | `https://comms.bwb.pt/admin` |
| MCP read-only | `https://comms.bwb.pt/mcp` (Bearer `COMMS_AUTH_TOKEN`) |
| State | `/var/lib/bwb-comms/` (`comms.db`, `comms.env`, `files/`) |
| Unit | `bwb-comms.service` |
| Deploy | `bash deploy/install-comms.sh` (não reinicia conectores Claude) |

O processo faz IMAP + arquivo WhatsApp (allowlist) + regras de pasta. ChatGPT Pro só lê o pack `/admin/pack.md` ou o MCP de leitura. Sem API OpenAI.

Agendamentos (Europe/Lisbon), réplica dos tasks Claude Desktop:

- `weekday-inbox-triage` — dias úteis a partir das 07:00: relatório de não lidos, arquivo helpdesk@bwb.pt por cliente (OTOBO), newsletters/marketing + purge >8 dias. Sem rascunhos LLM.
- `atualizacao-base-de-conhecimento-agt` — todos os dias a partir das 12:00: grupo `AGT - IVA ANGOLA`, keywords, drafts KB + JSON em `/var/lib/bwb-comms/agt/`, cópia de anexos se existirem no store.

Correr à mão: `/admin/jobs`.

DNS: `A comms.bwb.pt` → o mesmo VPS.

```bash
systemctl status bwb-comms
journalctl -u bwb-comms -f
```

## Backup

- `/var/lib/mail-mcp/`
- `/var/lib/whatsapp-mcp/` (admin, OAuth keys, `accounts/*/store`)
- `/var/lib/bwb-comms/`

## Safety

Prefer `move_message` to Trash over `delete_message`. WhatsApp bridge is unofficial (whatsmeow) — residual Meta account risk.
