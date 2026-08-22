import { ImapFlow } from "imapflow";
import type { MailAccount } from "../accounts.js";
import { ensureFreshAccessToken, imapAuth } from "../oauth.js";
import { inferFolderLayout, type FolderLayout } from "./folders.js";

export async function openImap(account: MailAccount): Promise<ImapFlow> {
  const acc = await ensureFreshAccessToken(account);
  const client = new ImapFlow({
    host: acc.imap.host,
    port: acc.imap.port,
    secure: acc.imap.tls,
    auth: imapAuth(acc),
    logger: false,
    connectionTimeout: 25_000,
    greetingTimeout: 25_000,
  });
  await client.connect();
  return client;
}

export async function listMailboxPaths(client: ImapFlow): Promise<string[]> {
  const boxes = await client.list();
  return boxes.map((b) => b.path).filter(Boolean).sort();
}

export async function loadLayout(client: ImapFlow): Promise<FolderLayout> {
  return inferFolderLayout(await listMailboxPaths(client));
}

export async function ensureFolder(client: ImapFlow, path: string): Promise<void> {
  try {
    await client.mailboxCreate(path);
  } catch {
    // exists
  }
  try {
    await client.mailboxSubscribe(path);
  } catch {
    // ignore
  }
}

export function envelopeFrom(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (v && typeof v === "object" && "address" in v) {
          const o = v as { name?: string; address?: string };
          return o.address ? `${o.name ?? ""} <${o.address}>` : String(o.address ?? "");
        }
        return String(v);
      })
      .join(", ");
  }
  return String(value);
}

export async function searchUids(
  client: ImapFlow,
  folder: string,
  query: { seen?: boolean; from?: string; before?: Date }
): Promise<number[]> {
  const lock = await client.getMailboxLock(folder);
  try {
    const raw = await client.search(
      {
        seen: query.seen,
        from: query.from,
        before: query.before,
        all: query.seen === undefined && !query.from && !query.before ? true : undefined,
      },
      { uid: true }
    );
    if (!raw) return [];
    return Array.isArray(raw) ? raw.map(Number) : [];
  } finally {
    lock.release();
  }
}

export interface ListedMsg {
  uid: number;
  fromHeader: string;
  subject: string;
  date: Date | null;
  messageId: string;
  headers: Record<string, string>;
}

export async function listEnvelopes(
  client: ImapFlow,
  folder: string,
  uids: number[]
): Promise<ListedMsg[]> {
  if (!uids.length) return [];
  const lock = await client.getMailboxLock(folder);
  const out: ListedMsg[] = [];
  try {
    for await (const msg of client.fetch(
      uids,
      { uid: true, envelope: true, headers: true },
      { uid: true }
    )) {
      const env = msg.envelope;
      out.push({
        uid: Number(msg.uid),
        fromHeader: envelopeFrom(env?.from),
        subject: envelopeFrom(env?.subject),
        date: env?.date ? new Date(env.date) : null,
        messageId: envelopeFrom(env?.messageId),
        headers: headerRecord(msg.headers),
      });
    }
  } finally {
    lock.release();
  }
  return out;
}

export async function fetchTextPreview(
  client: ImapFlow,
  folder: string,
  uid: number,
  max = 4000
): Promise<string> {
  const lock = await client.getMailboxLock(folder);
  try {
    const downloaded = await client.download(String(uid), undefined, { uid: true, maxBytes: max });
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.content) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8").slice(0, max);
  } catch {
    return "";
  } finally {
    lock.release();
  }
}

export async function moveUids(
  client: ImapFlow,
  fromFolder: string,
  uids: number[],
  dest: string
): Promise<number> {
  if (!uids.length) return 0;
  const lock = await client.getMailboxLock(fromFolder);
  try {
    await client.messageMove(uids, dest, { uid: true });
    return uids.length;
  } finally {
    lock.release();
  }
}

export async function deleteUids(client: ImapFlow, folder: string, uids: number[]): Promise<number> {
  if (!uids.length) return 0;
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageDelete(uids, { uid: true });
    return uids.length;
  } finally {
    lock.release();
  }
}

export function headerRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (raw instanceof Map) {
    for (const [k, v] of raw.entries()) {
      const text = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
      if (text) out[String(k).toLowerCase()] = text;
    }
    return out;
  }
  if (Buffer.isBuffer(raw) || typeof raw === "string") {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
    let current = "";
    for (const line of text.split(/\r?\n/)) {
      if (/^[ \t]/.test(line) && current) {
        out[current] = `${out[current]} ${line.trim()}`;
        continue;
      }
      const m = /^([^:\s]+):\s*(.*)$/.exec(line);
      if (m) {
        current = m[1].toLowerCase();
        out[current] = m[2] ?? "";
      }
    }
    return out;
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null) continue;
      out[k.toLowerCase()] = Array.isArray(v) ? String(v[0] ?? "") : String(v);
    }
  }
  return out;
}
