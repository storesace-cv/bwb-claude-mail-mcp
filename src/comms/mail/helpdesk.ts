import { commsConfig } from "../config.js";

const TICKET_RE = /Ticket#\s*(\d{8,})/i;
const CLIENTE_RE = /Cliente:\s*(.+)/i;

const COMPANY_HEADER_KEYS = [
  "x-bwb-customercompany",
  "x-bwb-customer-company",
  "x-bwb-company",
  "x-bwb-customer",
  "x-bwb-customerid",
];

export function xBwbHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.startsWith("x-bwb-") && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function ticketFromHeaders(headers: Record<string, string>): string | null {
  const n = headers["x-bwb-ticketnumber"]?.trim();
  return n || null;
}

export function clientNameFromHeaders(headers: Record<string, string>): string | null {
  const xbwb = xBwbHeaders(headers);
  for (const key of COMPANY_HEADER_KEYS) {
    const v = xbwb[key];
    if (v) return v;
  }
  return null;
}

export function ticketNumberFrom(subject: string, body: string): string | null {
  return TICKET_RE.exec(subject)?.[1] ?? TICKET_RE.exec(body)?.[1] ?? null;
}

export function clienteLineFrom(body: string): string | null {
  const m = CLIENTE_RE.exec(body);
  return m?.[1]?.trim() || null;
}

export async function lookupCustomerCompany(ticketNumber: string): Promise<string | null> {
  const base = commsConfig.helpdeskContextUrl;
  const token = commsConfig.helpdeskContextToken;
  if (!base || !token) return null;
  const url = new URL(base);
  url.searchParams.set("TicketNumber", ticketNumber);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const nested = json.body && typeof json.body === "object" ? (json.body as Record<string, unknown>) : json;
    const company =
      nested.customer_company ??
      nested.customerCompany ??
      nested.CustomerCompany ??
      (nested.customer && typeof nested.customer === "object"
        ? (nested.customer as Record<string, unknown>).company
        : undefined);
    return company ? String(company).trim() : null;
  } catch {
    return null;
  }
}

/** X-BWB-* first, then OTOBO API, then "Cliente:" in the body. */
export async function resolveHelpdeskClient(input: {
  headers: Record<string, string>;
  subject: string;
  body: string;
}): Promise<{ clientName: string | null; ticket: string | null; source: string }> {
  const fromHeader = clientNameFromHeaders(input.headers);
  const ticket = ticketFromHeaders(input.headers) || ticketNumberFrom(input.subject, input.body);
  if (fromHeader) return { clientName: fromHeader, ticket, source: "x-bwb" };
  if (ticket) {
    try {
      const company = await lookupCustomerCompany(ticket);
      if (company) return { clientName: company, ticket, source: "otobo-api" };
    } catch {
      // fall through
    }
  }
  const fromBody = clienteLineFrom(input.body);
  if (fromBody) return { clientName: fromBody, ticket, source: "body" };
  return { clientName: null, ticket, source: "none" };
}
