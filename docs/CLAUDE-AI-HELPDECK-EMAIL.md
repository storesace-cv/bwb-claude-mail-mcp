# Claude.ai / Claude Desktop — emails do Helpdesk BWB

Usa o conector **mcp-mail.bwb.pt** (conta IMAP pessoal/admin — **não** as caixas de intake do PostMaster).

Depois de um deploy MCP, **reconecta o conector** (ou reinicia o Claude Desktop) e abre um chat novo para refrescar as tools.

## Fluxo recomendado (organização Helpdesk)

1. `list_messages` / `search_messages` — encontrar a mensagem (usa `folder_status` se quiseres unseen/total).
2. `get_message` — ler o corpo **e** o bloco `bwb` / `headersRelevant`.
3. Se `bwb.ticket_number` existir (ou o assunto tiver `Ticket#…`), chamar `helpdesk_ticket_context`.
4. Decidir a pasta destino (ex. `INBOX.clientes.Kinda`).
5. `list_folders` — se faltar, `create_folder`; para renomear/apagar pastas: `rename_folder` / `delete_folder`.
6. `move_message` (ou `copy_message` se quiseres manter o original).
7. Opcional: `mark_read`, `mark_flagged`; anexos: `get_attachment` (índice ou filename de `get_message.attachments`).

## Inventário de tools (Mail MCP BWB)

**Contas:** `list_accounts`

**Leitura:** `list_folders`, `folder_status`, `list_messages`, `search_messages`, `get_message`, `get_attachment`

**Escrita mail:** `send_message`, `create_draft`, `mark_read`, `mark_flagged`, `move_message`, `copy_message`, `delete_message`

**Pastas:** `create_folder`, `rename_folder`, `delete_folder`

**Helpdesk:** `helpdesk_ticket_context`

**Calendário** (só se CalDAV estiver configurado na conta em `/admin`): `list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event`, `find_free_slot`

## Campos `bwb` (em `get_message`)

| Campo | Significado |
|---|---|
| `ticket_number` | Número OTOBO (`Ticket#…` no assunto ou header) |
| `ticket_id` | ID interno (só se veio em `X-BWB-TicketID`) |
| `direction` | `outbound` / `inbound` / `notification` / `intake-declaration` |
| `source` | `compose` / `worksheet` / `intake` / `notification` (com headers) |
| `queue` / `customer_id` / `customer_user` / `state` / `priority` / `store` | Com headers `X-BWB-*` |
| `confidence` / `notes` | Fiabilidade e origem da inferência |

Mails **antigos** (sem `X-BWB-*`): usa sempre `helpdesk_ticket_context` para cliente/utilizador/loja.

## Limites

- Não IMAP das filas PostMaster (`bwb-in` / ZS).
- `get_attachment`: por omissão máx. 5 MiB (até 15 MiB via `max_bytes`).
- `delete_folder` / `delete_message` / `delete_event` são destrutivos — preferir `move_message`.
- Calendário exige CalDAV na conta; a conta BWB Pessoal pode ainda não o ter.
- Não inventes o cliente só pelo `From`.
