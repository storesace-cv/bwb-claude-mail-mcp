import { commsConfig } from "../config.js";

const TICKET_RE = /Ticket#\s*(\d{8,})/i;
const CLIENTE_RE = /Cliente:\s*(.+)/i;

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
