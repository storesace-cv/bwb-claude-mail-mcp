/**
 * BWB Helpdesk email enrichment — parse Ticket# and X-BWB-* headers.
 */

export type BwbEmailContext = {
  ticket_number: string | null;
  ticket_id: string | null;
  direction: string | null;
  source: string | null;
  queue: string | null;
  customer_id: string | null;
  customer_user: string | null;
  state: string | null;
  priority: string | null;
  store: string | null;
  confidence: number;
  notes: string[];
};

const TICKET_RE = /Ticket#\s*(\d{8,})/i;

const SYSTEM_FROM_HINTS = [
  "helpdesk@bwb.pt",
  "helpdesk@storesace.cv",
  "assistencia@zsa-softwares.com",
  "helpdesk.storesace.cv",
];

function headerGet(
  headers: Map<string, unknown> | undefined,
  name: string
): string | null {
  if (!headers) return null;
  const raw = headers.get(name.toLowerCase());
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first === undefined || first === null ? null : String(first);
  }
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return String((raw as { value: unknown }).value);
  }
  return String(raw);
}

export function extractBwbHeaders(
  headers: Map<string, unknown> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of headers.entries()) {
    if (!key.toLowerCase().startsWith("x-bwb-")) continue;
    const text = Array.isArray(value)
      ? String(value[0] ?? "")
      : typeof value === "object" && value !== null && "value" in value
        ? String((value as { value: unknown }).value)
        : String(value ?? "");
    if (text) out[key.toLowerCase()] = text;
  }
  return out;
}

export function enrichBwbFromMessage(input: {
  subject?: string | null;
  from?: string | null;
  headers?: Map<string, unknown>;
}): { headersRelevant: Record<string, string>; bwb: BwbEmailContext } {
  const xBwb = extractBwbHeaders(input.headers);
  const notes: string[] = [];
  let ticket_number =
    xBwb["x-bwb-ticketnumber"] ||
    (input.subject ? TICKET_RE.exec(input.subject)?.[1] : undefined) ||
    null;
  if (ticket_number && !xBwb["x-bwb-ticketnumber"] && input.subject) {
    notes.push("ticket_number_from_subject");
  }

  const fromLower = (input.from || "").toLowerCase();
  let direction = xBwb["x-bwb-direction"] || null;
  if (!direction) {
    if (SYSTEM_FROM_HINTS.some((h) => fromLower.includes(h))) {
      direction = "outbound";
      notes.push("direction_from_system_from");
    } else if (input.from) {
      direction = "inbound";
      notes.push("direction_heuristic_inbound");
    }
  }

  let confidence = 0.3;
  if (xBwb["x-bwb-ticketnumber"]) confidence = 0.95;
  else if (ticket_number) confidence = 0.7;
  if (direction) confidence = Math.min(1, confidence + 0.1);

  const headersRelevant: Record<string, string> = { ...xBwb };
  for (const name of ["message-id", "in-reply-to", "references"]) {
    const v = headerGet(input.headers, name);
    if (v) headersRelevant[name] = v;
  }

  return {
    headersRelevant,
    bwb: {
      ticket_number,
      ticket_id: xBwb["x-bwb-ticketid"] || null,
      direction,
      source: xBwb["x-bwb-source"] || null,
      queue: xBwb["x-bwb-queue"] || null,
      customer_id: xBwb["x-bwb-customerid"] || null,
      customer_user: xBwb["x-bwb-customeruser"] || null,
      state: xBwb["x-bwb-state"] || null,
      priority: xBwb["x-bwb-priority"] || null,
      store: xBwb["x-bwb-store"] || null,
      confidence,
      notes,
    },
  };
}
