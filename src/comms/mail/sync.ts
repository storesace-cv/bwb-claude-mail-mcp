import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { listMailAccounts, myAddresses, type MailAccount } from "../accounts.js";
import { getDb, getCursor, setCursor } from "../db.js";
import { replaceMailFolders } from "../rules/store.js";
import { listMailboxPaths, createImapClient } from "./imap.js";
import { extractPdfText, isInvoiceCandidate } from "./invoices.js";
import {
  invoiceIssuers,
  invoiceRecipients,
  invoiceStage,
  mailAttachmentGateError,
  markInvoiceSeedDone,
} from "../settings.js";
import { shouldKeepInvoice } from "./invoice-whitelist.js";
import { invoiceObjectKey, putAttachment } from "../storage.js";
import { ensureFreshAccessToken } from "../oauth.js";
import { jobError, jobLog, jobProgress } from "../jobs/progress.js";
import { mailCutoffMs, mailMaxAgeDays } from "../settings.js";
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

async function downloadPart(
  client: ImapFlow,
  uid: number,
  part: string,
  timeoutMs: number
): Promise<Buffer> {
  const work = (async () => {
    const downloaded = await client.download(String(uid), part, { uid: true });
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.content) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Buffer>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function saveInvoiceAttachments(
  client: ImapFlow,
  account: MailAccount,
  pending: Array<{ uid: number; part: string; filename: string; mime: string; pk: number }>
): Promise<void> {
  const db = getDb();
  let i = 0;
  for (const inv of pending) {
    i += 1;
    jobLog(`${account.label}: a descarregar ${i}/${pending.length} ${inv.filename}`);
    try {
      const buf = await downloadPart(client, inv.uid, inv.part, 20_000);
      if (!buf.length) continue;
      const sha = createHash("sha256").update(buf).digest("hex");
      const exists = db.prepare("SELECT id FROM invoices WHERE sha256 = ?").get(sha);
      if (exists) continue;
      const text = inv.mime.includes("pdf") ? extractPdfText(buf) : "";
      const stage = invoiceStage();
      if (!shouldKeepInvoice(stage, text, invoiceIssuers(), invoiceRecipients())) {
        jobLog(`${account.label}: anexo ${inv.filename} descartado (listas brancas / fase ${stage}).`);
        continue;
      }
      const key = invoiceObjectKey(account.id, sha, inv.filename);
      await putAttachment(key, buf, inv.mime);
      db.prepare(
        `INSERT INTO invoices (account_id, mail_message_pk, filename, sha256, path, mime, extracted_text, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(account.id, inv.pk, inv.filename, sha, key, inv.mime, text, Date.now());
      jobLog(`${account.label}: anexo ${inv.filename} guardado.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      jobLog(`${account.label}: anexo ${inv.filename} ignorado (${msg}).`);
      log("warn", "invoice download failed", {
        account: account.id,
        uid: inv.uid,
        error: msg,
      });
    }
  }
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
    const msg = err instanceof Error ? err.message : String(err);
    log("warn", "mailbox open failed", {
      account: account.id,
      folder,
      error: msg,
    });
    jobError(`${account.label} · ${folder}: não abriu (${msg})`);
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
    const ageDays = mailMaxAgeDays();
    const cutoffMs = mailCutoffMs();
    const since = new Date(cutoffMs);
    const sinceDay = since.toISOString().slice(0, 10);
    jobLog(
      `${account.label} · ${folder}: só mensagens desde ${sinceDay} (${ageDays} dias).`
    );
    const searched = await client.search({ since }, { uid: true });
    const sinceUids = (Array.isArray(searched) ? searched : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    const uids = sinceUids.filter((n) => n > lastUid).sort((a, b) => a - b);
    if (!uids.length) {
      jobLog(`${account.label} · ${folder}: nada de novo dentro do prazo.`);
      return 0;
    }
    const batches: string[] = [];
    for (let i = 0; i < uids.length; i += 250) {
      batches.push(uids.slice(i, i + 250).join(","));
    }
    jobLog(`${account.label} · ${folder}: ${uids.length} UIDs desde ${sinceDay}.`);
    let maxUid = lastUid;
    let count = 0;
    let skippedOld = 0;
    const pendingInvoices: Array<{
      uid: number;
      part: string;
      filename: string;
      mime: string;
      pk: number;
    }> = [];
    const mine = myAddresses(account);
    const db = getDb();
    const lookup = db.prepare(
      `SELECT thread_key FROM mail_messages
       WHERE account_id = ? AND message_id = ? LIMIT 1`
    );

    for (const batch of batches) {
    for await (const msg of client.fetch(
      { uid: batch },
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
      if (dateMs < cutoffMs) {
        skippedOld += 1;
        continue;
      }
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
      if (count === 1 || count % 50 === 0) {
        jobLog(`${account.label} · ${folder}: ${count} mensagens lidas…`);
        setCursor(cursorKey, String(maxUid));
        jobProgress(Math.min(68, 4 + Math.floor(count / 40)));
      }

      const parts = walkStructure(msg.bodyStructure as StructureNode | undefined);
      if (invoiceStage() !== "review") {
        for (const part of parts) {
          const mime = `${part.type}/${part.subtype}`;
          if (!isInvoiceCandidate(part.filename, mime)) continue;
          pendingInvoices.push({
            uid,
            part: part.part,
            filename: part.filename,
            mime,
            pk,
          });
        }
      }
    }
    }
    if (maxUid > lastUid) setCursor(cursorKey, String(maxUid));
    if (skippedOld) {
      jobLog(`${account.label} · ${folder}: ${skippedOld} mensagens fora do prazo ignoradas.`);
    }
    if (pendingInvoices.length) {
      jobLog(
        `${account.label} · ${folder}: a descarregar ${pendingInvoices.length} anexos de factura (depois do FETCH).`
      );
      await saveInvoiceAttachments(client, account, pendingInvoices);
    }
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
  const gate = mailAttachmentGateError();
  if (gate) {
    jobError(gate);
    throw new Error(gate);
  }
  const accounts = await listMailAccounts();
  jobLog(`${accounts.length} contas de correio.`);
  if (invoiceStage() === "review") {
    jobLog(
      "Listas brancas: preenche destinatários e revê emissores em Definições. Novos anexos não são guardados. Depois do Re-aplicar, documentos que não casem no PDF serão apagados."
    );
  }
  let fetched = 0;
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    jobProgress(Math.round((i / Math.max(accounts.length, 1)) * 70));
    jobLog(`A ler ${account.label} (${i + 1}/${accounts.length})…`);
    try {
      const r = await syncMailAccount(account);
      fetched += r.fetched;
      jobLog(`${account.label}: ${r.fetched} mensagens novas.`);
      log("info", "mail sync ok", { account: account.id, fetched: r.fetched });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      jobError(`${account.label}: ${msg}`);
      log("error", "mail sync failed", { account: account.id, error: msg });
    }
    jobProgress(Math.round(((i + 1) / Math.max(accounts.length, 1)) * 70));
  }
  markInvoiceSeedDone();
  return { accounts: accounts.length, fetched };
}
