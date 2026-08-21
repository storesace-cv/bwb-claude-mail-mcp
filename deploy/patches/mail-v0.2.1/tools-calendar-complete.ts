/**
 * Extra calendar tools (BWB) — update + delete events.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ClientPool } from "./client-pool.js";

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

const accountSchema = z
  .string()
  .optional()
  .describe(
    "Account ID (from list_accounts) to act on. Omit to use the default account."
  );

const isoDateTime = z
  .string()
  .describe("ISO-8601 date or date-time (YYYY-MM-DD or full timestamp)");

function requireCaldav(pool: ClientPool, account?: string) {
  const { caldav } = pool.for(account);
  if (!caldav) {
    throw new Error(
      "CalDAV is not configured for this account. Add CalDAV in /admin (settings) first."
    );
  }
  return caldav;
}

export function registerCalendarCompleteTools(
  server: McpServer,
  pool: ClientPool
): void {
  server.registerTool(
    "delete_event",
    {
      description:
        "Delete a calendar event by its object URL (from list_events). DESTRUCTIVE WRITE. Requires CalDAV on the account.",
      inputSchema: {
        event_url: z
          .string()
          .url()
          .describe("Event object URL as returned by list_events"),
        account: accountSchema,
      },
    },
    async ({ event_url, account }) => {
      const caldav = requireCaldav(pool, account);
      await caldav.deleteEvent(event_url);
      return asJson({ success: true, event_url });
    }
  );

  server.registerTool(
    "update_event",
    {
      description:
        "Replace a calendar event (CalDAV update). WRITE OPERATION. Pass event_url from list_events plus the full new fields (summary/start/end/…). Requires CalDAV.",
      inputSchema: {
        event_url: z.string().url(),
        calendar_url: z.string().url(),
        summary: z.string().min(1),
        start: isoDateTime,
        end: isoDateTime,
        all_day: z.boolean().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        account: accountSchema,
      },
    },
    async (args) => {
      const caldav = requireCaldav(pool, args.account);
      const result = await caldav.updateEvent({
        eventUrl: args.event_url,
        calendarUrl: args.calendar_url,
        summary: args.summary,
        description: args.description,
        location: args.location,
        start: args.start,
        end: args.end,
        allDay: args.all_day,
      });
      return asJson({ success: true, ...result });
    }
  );
}
