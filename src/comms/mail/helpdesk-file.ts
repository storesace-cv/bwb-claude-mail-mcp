import type { MailAccount } from "../accounts.js";
import { folderPath, sanitizeFolderSegment } from "./folders.js";
import { resolveHelpdeskClient, ticketFromHeaders, ticketNumberFrom } from "./helpdesk.js";
import {
  ensureFolder,
  fetchTextPreview,
  listEnvelopes,
  loadLayout,
  moveUids,
  searchUids,
  type ListedMsg,
} from "./imap.js";
import type { ImapFlow } from "imapflow";

const HELPDESK_FROM = ["helpdesk@bwb.pt", "helpdesk@storesace.cv"];

export interface HelpdeskFileResult {
  byFolder: Record<string, number>;
  unclassified: number;
  errors: string[];
}

export async function fileHelpdeskMail(
  client: ImapFlow,
  _account: MailAccount
): Promise<HelpdeskFileResult> {
  const layout = await loadLayout(client);
  const uidSet = new Set<number>();
  for (const from of HELPDESK_FROM) {
    for (const uid of await searchUids(client, "INBOX", { from })) uidSet.add(uid);
  }
  const msgs = await listEnvelopes(client, "INBOX", [...uidSet].slice(0, 200));
  const byFolder: Record<string, number> = {};
  let unclassified = 0;
  const errors: string[] = [];

  const groups = new Map<string, ListedMsg[]>();
  for (const msg of msgs) {
    let body = "";
    const headerTicket = ticketFromHeaders(msg.headers);
    let ticket = headerTicket || ticketNumberFrom(msg.subject, "");
    if (!ticket) {
      body = await fetchTextPreview(client, "INBOX", msg.uid);
      ticket = ticketNumberFrom(msg.subject, body);
    }
    if (!body && !clientNameLikelyInHeaders(msg.headers)) {
      body = await fetchTextPreview(client, "INBOX", msg.uid);
    }
    let resolved;
    try {
      resolved = await resolveHelpdeskClient({
        headers: msg.headers,
        subject: msg.subject,
        body,
      });
    } catch (err) {
      errors.push(`uid ${msg.uid}: ${err instanceof Error ? err.message : String(err)}`);
      resolved = { clientName: null, ticket, source: "none" };
    }
    const dest = resolved.clientName
      ? folderPath(layout, "helpdesk", sanitizeFolderSegment(resolved.clientName, layout.delimiter))
      : folderPath(layout, "helpdesk", "_sem-cliente");
    if (!resolved.clientName) unclassified += 1;
    const list = groups.get(dest) ?? [];
    list.push(msg);
    groups.set(dest, list);
  }

  for (const [dest, list] of groups) {
    await ensureFolder(client, dest);
    const n = await moveUids(
      client,
      "INBOX",
      list.map((m) => m.uid),
      dest
    );
    byFolder[dest] = n;
  }
  return { byFolder, unclassified, errors };
}

function clientNameLikelyInHeaders(headers: Record<string, string>): boolean {
  return Boolean(
    headers["x-bwb-customercompany"] ||
      headers["x-bwb-customer-company"] ||
      headers["x-bwb-company"] ||
      headers["x-bwb-customer"] ||
      headers["x-bwb-customerid"]
  );
}
