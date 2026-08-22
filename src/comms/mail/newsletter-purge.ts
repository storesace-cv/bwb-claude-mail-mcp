import type { ImapFlow } from "imapflow";
import { classifyPromo } from "./classify-promo.js";
import { folderPath } from "./folders.js";
import {
  deleteUids,
  ensureFolder,
  listEnvelopes,
  loadLayout,
  moveUids,
  searchUids,
} from "./imap.js";

export interface NewsletterResult {
  filedNewsletters: number;
  filedMarketing: number;
  purgedNewsletters: number;
  purgedMarketing: number;
  leftInInbox: number;
}

export async function fileAndPurgePromo(client: ImapFlow): Promise<NewsletterResult> {
  const layout = await loadLayout(client);
  const newsPath = folderPath(layout, "newsletters");
  const mktPath = folderPath(layout, "marketing");
  await ensureFolder(client, newsPath);
  await ensureFolder(client, mktPath);

  const inboxUids = await searchUids(client, "INBOX", {});
  const msgs = await listEnvelopes(client, "INBOX", inboxUids.slice(0, 400));
  const toNews: number[] = [];
  const toMkt: number[] = [];
  let leftInInbox = 0;
  for (const msg of msgs) {
    const bucket = classifyPromo({ fromHeader: msg.fromHeader, subject: msg.subject });
    if (bucket === "newsletters") toNews.push(msg.uid);
    else if (bucket === "marketing") toMkt.push(msg.uid);
    else leftInInbox += 1;
  }
  const filedNewsletters = await moveUids(client, "INBOX", toNews, newsPath);
  const filedMarketing = await moveUids(client, "INBOX", toMkt, mktPath);

  const cutoff = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  const purgedNewsletters = await purgeOlder(client, newsPath, cutoff);
  const purgedMarketing = await purgeOlder(client, mktPath, cutoff);

  return {
    filedNewsletters,
    filedMarketing,
    purgedNewsletters,
    purgedMarketing,
    leftInInbox,
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
