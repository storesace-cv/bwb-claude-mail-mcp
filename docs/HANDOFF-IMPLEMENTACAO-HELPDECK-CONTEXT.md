# Handoff: contexto Helpdesk nos emails (implementação)

Destinatário: agente Cursor / Claude a programar. Repos: `bwb-otobo-custom` + `bwb-claude-mail-mcp`.

## Objectivo

1. Headers `X-BWB-*` em emails **enviados** pelo OTOBO.
2. `get_message` no MCP devolve bloco `bwb` + `headersRelevant`.
3. Tool `helpdesk_ticket_context` faz lookup read-only no helpdesk (Bearer).

## O que **não** fazer

- Não apontar IMAP do MCP às caixas PostMaster (`bwb-in` / ZS).
- Não meter HTML oculto / comentários no corpo do mail.
- Não commitir `BWBTicketContext::BearerToken` nem `HELPDESK_CONTEXT_TOKEN`.
- Não instalar o MCP no VPS do OTOBO.

## Ordem de implementação (já feita no código — verificar)

### A — OTOBO (`bwb-otobo-custom`)

| Ficheiro | Papel |
|---|---|
| `otobo/Custom/Kernel/System/BWBEmailContext.pm` | Headers + JSON context |
| `otobo/Custom/Kernel/System/Email.pm` | Wrapper: injecta headers, carrega núcleo como `Email::Core` |
| `otobo/Custom/Kernel/Modules/PublicBWBTicketContext.pm` | API pública JSON |
| `otobo/Custom/Kernel/Config/Files/XML/BWBTicketContext.xml` | Registo módulo + settings |
| Call sites `BWBSource` | WorkSession `worksheet`, Intake `intake`, Notification `notification` |

Deploy OTOBO:

```sh
bash scripts/check.sh
bash scripts/deploy-production.sh --apply
bash scripts/verify-runtime-permissions.sh --production
```

No servidor, criar `/opt/otobo/Kernel/Config/Files/ZZZBWBTicketContext.pm` (otobo:www-data 640):

```perl
package Kernel::Config::Files::ZZZBWBTicketContext;
use strict; use warnings;
sub Load {
  my ($File, $Self) = @_;
  $Self->{'BWBTicketContext::BearerToken'} = 'TOKEN_OPENSSL_RAND_HEX_32';
  $Self->{'BWBTicketContext::AllowedIPs'} = [ 'IP_VPS_MCP_MAIL' ];
  return 1;
}
1;
```

Depois: `Maint::Config::Rebuild`, reaplicar permissões `ZZZAAuto.pm` / `ZZZBWB*.pm`, `Maint::Cache::Delete`.

Teste:

```sh
curl -sS -H "Authorization: Bearer TOKEN" \
  'https://helpdesk.storesace.cv/otobo/public.pl?Action=PublicBWBTicketContext;TicketNumber=2026081662000014'
# sem token → unauthorized; ticket inexistente → ticket_not_found
```

### B — Mail MCP (`bwb-claude-mail-mcp`)

| Path | Papel |
|---|---|
| `deploy/patches/mail-v0.2.1/apply.py` | Patches idempotentes no upstream v0.2.1 |
| `deploy/patches/mail-v0.2.1/helpdesk-enrich.ts` | Parser Ticket# / X-BWB-* |
| `deploy/patches/mail-v0.2.1/tools-helpdesk.ts` | Tool MCP |
| `deploy/install.sh` | Corre `apply.py` após `git checkout` |

No VPS MCP, em `/var/www/mail-mcp/.env`:

```
HELPDESK_CONTEXT_URL=https://helpdesk.storesace.cv/otobo/public.pl?Action=PublicBWBTicketContext
HELPDESK_CONTEXT_TOKEN=mesmo_token_otobo
```

Redeploy: rsync repo + `bash deploy/install.sh` (como root no VPS).

## Contrato headers

`X-BWB-TicketNumber`, `X-BWB-TicketID`, `X-BWB-Direction`, `X-BWB-Source`, `X-BWB-Queue`, `X-BWB-CustomerID`, `X-BWB-CustomerUser`, `X-BWB-State`, `X-BWB-Priority`, `X-BWB-Store`.

Sources: `compose` | `worksheet` | `intake` | `notification` | `outbound`.

## Checklist

- [ ] Compose num ticket → IMAP `get_message` mostra `bwb.ticket_number` e headers X-BWB
- [ ] Inbound com `[Ticket#…]` → `helpdesk_ticket_context` devolve cliente/utilizador
- [ ] Bearer inválido → 401; ticket inexistente → `ok:false`
- [ ] Docs FEATURES / OPERATIONS / SECURITY / ROADMAP actualizados
