# Claude.ai / Claude Desktop — emails do Helpdesk BWB

Usa o conector **mcp-mail.bwb.pt** (conta IMAP pessoal/admin — **não** as caixas de intake do PostMaster).

## Fluxo recomendado

1. `list_messages` / `search_messages` — encontrar a mensagem.
2. `get_message` — ler o corpo **e** o bloco `bwb` / `headersRelevant`.
3. Se `bwb.ticket_number` existir (ou o assunto tiver `Ticket#…`), chamar `helpdesk_ticket_context` com esse número.

## Campos `bwb` (em `get_message`)

| Campo | Significado |
|---|---|
| `ticket_number` | Número OTOBO (`Ticket#…` no assunto ou header) |
| `ticket_id` | ID interno (só se veio em `X-BWB-TicketID`) |
| `direction` | `outbound` (helpdesk→cliente), `inbound` (cliente→helpdesk), `notification`, `intake-declaration` |
| `source` | `compose`, `worksheet`, `intake`, `notification` (só outbound com headers) |
| `queue` / `customer_id` / `customer_user` / `state` / `priority` / `store` | Presentes quando o mail foi **enviado pelo helpdesk** com headers `X-BWB-*` |
| `confidence` | 0–1; headers X-BWB ≈ 0.95; só assunto ≈ 0.7 |
| `notes` | Como o valor foi inferido |

## Tool `helpdesk_ticket_context`

Read-only. Devolve cliente, utilizador de cliente, fila, estado, prioridade, loja do ticket, URL do zoom do agente.

Usar quando:

- o email do **cliente** não tem `X-BWB-*` (só o `Ticket#` no assunto);
- precisas de confirmação fiável de cliente/utilizador/loja.

## Limites

- Emails **do cliente** não trazem headers BWB — só o assunto / threading.
- «Urgente» no texto livre **não** é contrato; usa `priority` / `state` do lookup.
- Não peças para abrir IMAP das filas `bwb-in` / `zsangola-in` / `zs-postmaster`.
- Não inventes o cliente a partir do `From` sozinho (pode ser alias ou secretária).

## Exemplos de interpretação

| Situação | Como interpretar |
|---|---|
| `bwb.source = compose` + headers | Resposta de agente no Compose |
| `bwb.source = worksheet` | Folha de trabalho enviada ao cliente |
| `bwb.source = intake` | Declaração «Nova ocorrência registada…» |
| `direction = inbound` + Ticket# | Follow-up ou pedido do cliente; fazer lookup |
| Sem Ticket# e From externo | Possível novo pedido; não há ticket ainda |
