import { promises as fs } from "node:fs";
import { commsConfig } from "../config.js";
import { listMailAccounts, type MailAccount } from "../accounts.js";
import { getDb } from "../db.js";
import { ensureFreshAccessToken } from "../oauth.js";
import { createImapClient } from "../mail/imap.js";
import { uniqueMatchingDest, type FolderRule } from "./match.js";

export async function loadRules(): Promise<FolderRule[]> {
  try {
    const raw = await fs.readFile(commsConfig.rulesFile, "utf8");
    const parsed = JSON.parse(raw) as { rules?: FolderRule[] };
    return Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveRules(rules: FolderRule[]): Promise<void> {
  const tmp = `${commsConfig.rulesFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ rules }, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, commsConfig.rulesFile);
}

export async function applyFolderRules(): Promise<{ moved: number; skippedConflict: number }> {
  const rules = await loadRules();
  if (!rules.length) return { moved: 0, skippedConflict: 0 };
  const accounts = await listMailAccounts();
  let moved = 0;
  let skippedConflict = 0;
  for (const account of accounts) {
    const r = await applyForAccount(account, rules);
    moved += r.moved;
    skippedConflict += r.skippedConflict;
  }
  return { moved, skippedConflict };
}

async function applyForAccount(
  account: MailAccount,
  rules: FolderRule[]
): Promise<{ moved: number; skippedConflict: number }> {
  const db = getDb();
  const candidates = db
    .prepare(
      `SELECT id, folder, uid, uidvalidity, from_header, subject
       FROM mail_messages
       WHERE account_id = ? AND folder = 'INBOX'`
    )
    .all(account.id) as {
    id: number;
    folder: string;
    uid: number;
    uidvalidity: number;
    from_header: string;
    subject: string;
  }[];

  const byDest = new Map<string, typeof candidates>();
  let skippedConflict = 0;
  for (const row of candidates) {
    const hit = uniqueMatchingDest(rules, {
      accountId: account.id,
      fromHeader: row.from_header,
      subject: row.subject,
    });
    if (!hit) {
      const matching = rules.filter((r) => {
        const fromOk =
          !r.matchFrom.trim() || row.from_header.toLowerCase().includes(r.matchFrom.toLowerCase());
        return (r.accountId === "*" || r.accountId === account.id) && fromOk;
      });
      const dests = new Set(matching.filter((r) => {
        const sub = r.matchSubject.trim().toLowerCase();
        return !sub || row.subject.toLowerCase().includes(sub);
      }).map((r) => r.destFolder));
      if (dests.size > 1) skippedConflict += 1;
      continue;
    }
    const list = byDest.get(hit.destFolder) ?? [];
    list.push(row);
    byDest.set(hit.destFolder, list);
  }

  if (!byDest.size) return { moved: 0, skippedConflict };

  const acc = await ensureFreshAccessToken(account);
  const client = createImapClient(acc);
  let moved = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uidvalidity = Number((client.mailbox as { uidValidity?: bigint | number } | undefined)?.uidValidity ?? 0);
      for (const [dest, rows] of byDest) {
        const uids = rows.filter((r) => r.uidvalidity === uidvalidity).map((r) => r.uid);
        if (!uids.length) continue;
        try {
          await client.messageMove(uids, dest, { uid: true });
          const placeholders = uids.map(() => "?").join(",");
          db.prepare(
            `UPDATE mail_messages SET folder = ? WHERE account_id = ? AND folder = 'INBOX'
             AND uidvalidity = ? AND uid IN (${placeholders})`
          ).run(dest, account.id, uidvalidity, ...uids);
          moved += uids.length;
        } catch (err) {
          console.error(
            JSON.stringify({
              ts: new Date().toISOString(),
              level: "error",
              msg: "imap move failed",
              dest,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return { moved, skippedConflict };
}
