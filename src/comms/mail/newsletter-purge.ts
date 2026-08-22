import type { ImapFlow } from "imapflow";
import { classifyPromo, purgeDaysByFolder } from "./classify-promo.js";
import { folderPath } from "./folders.js";
import {
  deleteUids,
  ensureFolder,
  listEnvelopes,
  loadLayout,
  moveUids,
  searchUids,
} from "./imap.js";
import { listMailRules } from "../rules/store.js";

export interface NewsletterResult {
  filed: Record<string, number>;
  purged: Record<string, number>;
  leftInInbox: number;
  filedNewsletters: number;
  filedMarketing: number;
  purgedNewsletters: number;
  purgedMarketing: number;
}

export async function fileAndPurgePromo(
  client: ImapFlow,
  accountId?: string
): Promise<NewsletterResult> {
  const layout = await loadLayout(client);
  const rules = listMailRules(true).filter(
    (r) => r.accountId === "*" || !accountId || r.accountId === accountId
  );
  const inboxUids = await searchUids(client, "INBOX", {});
  const msgs = await listEnvelopes(client, "INBOX", inboxUids.slice(0, 400));
  const buckets = new Map<string, number[]>();
  let leftInInbox = 0;
  for (const msg of msgs) {
    const dest = classifyPromo({
      fromHeader: msg.fromHeader,
      subject: msg.subject,
      accountId,
    });
    if (!dest) {
      leftInInbox += 1;
      continue;
    }
    const list = buckets.get(dest) ?? [];
    list.push(msg.uid);
    buckets.set(dest, list);
  }

  const filed: Record<string, number> = {};
  for (const [dest, uids] of buckets) {
    const destPath = dest.includes(".") || dest.includes("/") ? dest : folderPath(layout, dest);
    await ensureFolder(client, destPath);
    filed[dest] = await moveUids(client, "INBOX", uids, destPath);
  }

  const purged: Record<string, number> = {};
  for (const [dest, days] of purgeDaysByFolder(rules)) {
    const destPath = dest.includes(".") || dest.includes("/") ? dest : folderPath(layout, dest);
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    purged[dest] = await purgeOlder(client, destPath, cutoff);
  }

  return {
    filed,
    purged,
    leftInInbox,
    filedNewsletters: filed.newsletters ?? 0,
    filedMarketing: filed.marketing ?? 0,
    purgedNewsletters: purged.newsletters ?? 0,
    purgedMarketing: purged.marketing ?? 0,
  };
}

async function purgeOlder(client: ImapFlow, folder: string, before: Date): Promise<number> {
  let uids: number[] = [];
  try {
    uids = await searchUids(client, folder, { before });
  } catch {
    return 0;
  }
  return deleteUids(client, folder, uids);
}
