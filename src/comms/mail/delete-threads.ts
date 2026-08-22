import { listMailAccounts } from "../accounts.js";
import { getDb } from "../db.js";
import { createImapClient, deleteUids } from "./imap.js";
import { ensureFreshAccessToken } from "../oauth.js";
import { recomputeThreads } from "./sync.js";

export async function deleteUnansweredThreads(
  targets: Array<{ accountId: string; threadKey: string }>
): Promise<{ ok: number; failed: string[] }> {
  const unique = new Map<string, { accountId: string; threadKey: string }>();
  for (const t of targets) {
    const k = `${t.accountId}\0${t.threadKey}`;
    unique.set(k, t);
  }
  const accounts = await listMailAccounts();
  const byAccount = new Map<string, string[]>();
  for (const t of unique.values()) {
    const list = byAccount.get(t.accountId) ?? [];
    list.push(t.threadKey);
    byAccount.set(t.accountId, list);
  }
  const failed: string[] = [];
  let ok = 0;
  const db = getDb();
  for (const [accountId, keys] of byAccount) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      failed.push(`${accountId}: conta em falta`);
      continue;
    }
    const acc = await ensureFreshAccessToken(account);
    const client = createImapClient(acc);
    try {
      await client.connect();
      for (const threadKey of keys) {
        const msgs = db
          .prepare(
            `SELECT folder, uid FROM mail_messages
             WHERE account_id = ? AND thread_key = ?`
          )
          .all(accountId, threadKey) as Array<{ folder: string; uid: number }>;
        const byFolder = new Map<string, number[]>();
        for (const m of msgs) {
          const uids = byFolder.get(m.folder) ?? [];
          uids.push(m.uid);
          byFolder.set(m.folder, uids);
        }
        try {
          for (const [folder, uids] of byFolder) {
            await deleteUids(client, folder, uids);
          }
          db.prepare("DELETE FROM mail_messages WHERE account_id = ? AND thread_key = ?").run(
            accountId,
            threadKey
          );
          db.prepare("DELETE FROM mail_threads WHERE account_id = ? AND thread_key = ?").run(
            accountId,
            threadKey
          );
          ok += 1;
        } catch (err) {
          failed.push(
            `${account.label} · ${threadKey}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      recomputeThreads(accountId);
    } catch (err) {
      failed.push(`${account.label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
  return { ok, failed };
}
