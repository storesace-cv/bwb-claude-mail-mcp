/**
 * Helpdesk ticket context tool — calls PublicBWBTicketContext on OTOBO.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";

function asJson(value: unknown): { content: { type: "text"; text: string }[] } {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function registerHelpdeskTools(server: McpServer): void {
  server.registerTool(
    "helpdesk_ticket_context",
    {
      description:
        "Look up BWB/OTOBO helpdesk ticket context by TicketNumber (or TicketID). Returns customer company, customer user, queue, state, priority, store label and agent URL. Use after get_message when bwb.ticket_number is present, or when the subject contains Ticket#…. READ-ONLY.",
      inputSchema: {
        ticket_number: z
          .string()
          .optional()
          .describe("OTOBO ticket number, e.g. 2026081662000014"),
        ticket_id: z
          .string()
          .optional()
          .describe("OTOBO internal ticket id (numeric)"),
      },
    },
    async ({ ticket_number, ticket_id }) => {
      const base = config.helpdeskContextUrl;
      const token = config.helpdeskContextToken;
      if (!base || !token) {
        return asJson({
          ok: false,
          error: "helpdesk_context_not_configured",
          message:
            "Set HELPDESK_CONTEXT_URL and HELPDESK_CONTEXT_TOKEN in the mail-mcp backend .env",
        });
      }
      if (!ticket_number && !ticket_id) {
        return asJson({
          ok: false,
          error: "need_ticket_number_or_id",
        });
      }

      const url = new URL(base);
      if (ticket_number) url.searchParams.set("TicketNumber", ticket_number);
      if (ticket_id) url.searchParams.set("TicketID", ticket_id);

      try {
        const res = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        const text = await res.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // keep raw
        }
        return asJson({
          http_status: res.status,
          body,
        });
      } catch (err) {
        return asJson({
          ok: false,
          error: "helpdesk_request_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );
}
