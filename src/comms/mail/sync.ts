import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { listMailAccounts, myAddresses, type MailAccount } from "../accounts.js";
import { commsConfig } from "../config.js";
import { getDb, getCursor, setCursor } from "../db.js";
import { replaceMailFolders } from "../rules/store.js";
import { listMailboxPaths, createImapClient } from "./imap.js";
import { extractPdfText, isInvoiceCandidate } from "./invoices.js";
import { ensureFreshAccessToken } from "../oauth.js";
import {
  computeUnanswered,
  isFromMe,
  parseReferences,
  resolveThreadKey,
} from "./threads.js";

function log(level: string, msg: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

interface StructurePart {
  part: string;
  type: string;
  subtype: string;
  disposition: string | null;
  filename: string;
}

interface StructureNode {
  type?: string;
  subtype?: string;
  disposition?: string | null;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  childNodes?: StructureNode[];
}

function walkStructure(node: StructureNode | undefined, prefix = ""): StructurePart[] {
  if (!node) return [];
  const childNodes = node.childNodes ?? [];
  if (childNodes.length) {
    return childNodes.flatMap((child, i) =>
      walkStructure(child, prefix ? `${prefix}.${i + 1}` : String(i + 1))
    );
  }
  const part = prefix || "1";
  const type = String(node.type ?? "application").toLowerCase();
  const subtype = String(node.subtype ?? "octet-stream").toLowerCase();
  const disp = node.disposition ? String(node.disposition).toLowerCase() : null;
  const filename =
    (node.dispositionParameters?.filename as string | undefined) ||
    (node.parameters?.name as string | undefined) ||
    `part-${part}.${subtype}`;
  return [{ part, type, subtype, disposition: disp, filename }];
}

function mailboxUidValidity(client: ImapFlow): number {
  const mb = client.mailbox as { uidValidity?: bigint | number } | undefined;
  return Number(mb?.uidValidity ?? 0);
}

async function openClient(account: MailAccount): Promise<ImapFlow> {
  const acc = await ensureFreshAccessToken(account);
  const client = createImapClient(acc);
  await client.connect();
  return client;
}

function headerString(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string") return v;
        if (v && typeof v === "object" && "address" in v) {
          const o = v as { name?: string; address?: string };
          return o.name ? `${o.name} <${o.address}>` : String(o.address ?? "");
        }
        return String(v);
      })
      .join(", ");
  }
  return String(value);
}

export async function syncMailAccount(account: MailAccount): Promise<{ fetched: number }> {
  let fetched = 0;
  const client = await openClient(account);
  try {
    try {
      replaceMailFolders(account.id, await listMailboxPaths(client));
    } catch {
      // listing folders is best-effort for the admin UI
    }
    const folders = ["INBOX"];
    if (account.mail.sentFolder) folders.push(account.mail.sentFolder);
    for (const folder of folders) {
      fetched += await syncFolder(client, account, folder);
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  recomputeThreads(account.id);
  return { fetched };
}

async function syncFolder(
  client: ImapFlow,
  account: MailAccount,
  folder: string
): Promise<number> {
  let lock;
  try {
    lock = await client.getMailboxLock(folder);
  } catch (err) {
    log("warn", "mailbox open failed", {
      account: account.id,
      folder,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
  try {
    const uidvalidity = mailboxUidValidity(client);
    const cursorKey = `mail:${account.id}:${folder}:uid`;
    const validKey = `mail:${account.id}:${folder}:uidvalidity`;
    const storedValid = getCursor(validKey);
    if (storedValid && Number(storedValid) !== uidvalidity) {
      setCursor(cursorKey, "0");
    }
    setCursor(validKey, String(uidvalidity));
    const lastUid = Number(getCursor(cursorKey) ?? "0");
    const range = lastUid > 0 ? `${lastUid + 1}:*` : "1:*";
    let maxUid = lastUid;
    let count = 0;
    const mine = myAddresses(account);
    const db = getDb();
    const lookup = db.prepare(
      `SELECT thread_key FROM mail_messages
       WHERE account_id = ? AND message_id = ? LIMIT 1`
    );

    for await (const msg of client.fetch(
      { uid: range },
      { uid: true, envelope: true, flags: true, bodyStructure: true }
    )) {
      const uid = Number(msg.uid);
      if (!Number.isFinite(uid) || uid <= lastUid) continue;
      maxUid = Math.max(maxUid, uid);
      const env = msg.envelope;
      const messageId = headerString(env?.messageId);
      const inReplyTo = headerString(env?.inReplyTo);
      const subject = headerString(env?.subject);
      const fromHeader = headerString(env?.from);
      const toHeader = headerString(env?.to);
      const dateMs = env?.date ? new Date(env.date).getTime() : Date.now();
      const seen = Boolean(msg.flags?.has("\\Seen"));
      const fromMe = folder === account.mail.sentFolder || isFromMe(fromHeader, mine);
      const refs = parseReferences(headerString((env as { references?: unknown })?.references));
      const threadKey = resolveThreadKey(
        { messageId, inReplyTo, references: refs, fromHeader, toHeader, subject },
        (mid) => {
          const row = lookup.get(account.id, mid) as { thread_key: string } | undefined;
          return row?.thread_key;
        }
      );

      const insert = db.prepare(
        `INSERT INTO mail_messages (
           account_id, folder, uid, uidvalidity, message_id, in_reply_to, thread_key,
           from_header, to_header, subject, date_ms, from_me, seen
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(account_id, folder, uidvalidity, uid) DO UPDATE SET
           seen = excluded.seen, thread_key = excluded.thread_key`
      );
      const info = insert.run(
        account.id,
        folder,
        uid,
        uidvalidity,
        messageId || null,
        inReplyTo || null,
        threadKey,
        fromHeader,
        toHeader,
        subject,
        dateMs,
        fromMe ? 1 : 0,
        seen ? 1 : 0
      );
      const pk = Number(info.lastInsertRowid);
      count += 1;

      const parts = walkStructure(msg.bodyStructure as StructureNode | undefined);
      for (const part of parts) {
        const mime = `${part.type}/${part.subtype}`;
        if (!isInvoiceCandidate(part.filename, mime)) continue;
        try {
          const downloaded = await client.download(String(uid), part.part, { uid: true });
          const chunks: Buffer[] = [];
          for await (const chunk of downloaded.content) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const buf = Buffer.concat(chunks);
          if (!buf.length) continue;
          const sha = createHash("sha256").update(buf).digest("hex");
          const exists = db.prepare("SELECT id FROM invoices WHERE sha256 = ?").get(sha);
          if (exists) continue;
          const dir = path.join(commsConfig.filesDir, "invoices", account.id);
          await mkdir(dir, { recursive: true, mode: 0o700 });
          const safeName = part.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
          const dest = path.join(dir, `${sha.slice(0, 16)}-${safeName}`);
          await writeFile(dest, buf, { mode: 0o600 });
          const text = mime.includes("pdf") ? extractPdfText(buf) : "";
          db.prepare(
            `INSERT INTO invoices (account_id, mail_message_pk, filename, sha256, path, mime, extracted_text, created_at)
             VALUES (?,?,?,?,?,?,?,?)`
          ).run(account.id, pk, part.filename, sha, dest, mime, text, Date.now());
        } catch (err) {
          log("warn", "invoice download failed", {
            account: account.id,
            uid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    if (maxUid > lastUid) setCursor(cursorKey, String(maxUid));
    return count;
  } finally {
    lock.release();
  }
}

export function recomputeThreads(accountId: string): void {
  const db = getDb();
  const keys = db
    .prepare("SELECT DISTINCT thread_key FROM mail_messages WHERE account_id = ?")
    .all(accountId) as { thread_key: string }[];
  const msgsStmt = db.prepare(
    `SELECT from_me, date_ms, subject FROM mail_messages
     WHERE account_id = ? AND thread_key = ? ORDER BY date_ms ASC`
  );
  const upsert = db.prepare(
    `INSERT INTO mail_threads (account_id, thread_key, last_inbound_at, last_outbound_at, unanswered, subject)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(account_id, thread_key) DO UPDATE SET
       last_inbound_at = excluded.last_inbound_at,
       last_outbound_at = excluded.last_outbound_at,
       unanswered = excluded.unanswered,
       subject = excluded.subject`
  );
  for (const { thread_key } of keys) {
    const rows = msgsStmt.all(accountId, thread_key) as {
      from_me: number;
      date_ms: number;
      subject: string;
    }[];
    const calc = computeUnanswered(
      rows.map((r) => ({ fromMe: Boolean(r.from_me), dateMs: r.date_ms }))
    );
    const subject = rows.at(-1)?.subject ?? "";
    upsert.run(
      accountId,
      thread_key,
      calc.lastInboundAt,
      calc.lastOutboundAt,
      calc.unanswered ? 1 : 0,
      subject
    );
  }
}

export async function syncAllMail(): Promise<{ accounts: number; fetched: number }> {
  const accounts = await listMailAccounts();
  let fetched = 0;
  for (const account of accounts) {
    try {
      const r = await syncMailAccount(account);
      fetched += r.fetched;
      log("info", "mail sync ok", { account: account.id, fetched: r.fetched });
    } catch (err) {
      log("error", "mail sync failed", {
        account: account.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { accounts: accounts.length, fetched };
}
