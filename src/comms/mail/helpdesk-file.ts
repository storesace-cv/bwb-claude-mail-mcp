import type { MailAccount } from "../accounts.js";
import { folderPath, sanitizeFolderSegment } from "./folders.js";
import { clienteLineFrom, lookupCustomerCompany, ticketNumberFrom } from "./helpdesk.js";
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
  const uids = await searchUids(client, "INBOX", { from: "helpdesk@bwb.pt" });
  const msgs = await listEnvelopes(client, "INBOX", uids.slice(0, 200));
  const byFolder: Record<string, number> = {};
  let unclassified = 0;
  const errors: string[] = [];

  const groups = new Map<string, ListedMsg[]>();
  for (const msg of msgs) {
    let body = "";
    let ticket = ticketNumberFrom(msg.subject, "");
    if (!ticket) {
      body = await fetchTextPreview(client, "INBOX", msg.uid);
      ticket = ticketNumberFrom(msg.subject, body);
    }
    let clientName: string | null = null;
    if (ticket) {
      try {
        clientName = await lookupCustomerCompany(ticket);
      } catch (err) {
        errors.push(`ticket ${ticket}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!clientName) {
      if (!body) body = await fetchTextPreview(client, "INBOX", msg.uid);
      clientName = clienteLineFrom(body);
    }
    const dest = clientName
      ? folderPath(layout, "helpdesk", sanitizeFolderSegment(clientName, layout.delimiter))
      : folderPath(layout, "helpdesk", "_sem-cliente");
    if (!clientName) unclassified += 1;
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
