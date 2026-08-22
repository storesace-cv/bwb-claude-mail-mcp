import Database from "better-sqlite3";
import { getDb } from "../db.js";

export function filterAllowedJids<T extends { chat_jid: string }>(
  allowed: Set<string>,
  rows: T[]
): T[] {
  return rows.filter((r) => allowed.has(r.chat_jid));
}

export function isAllowed(accountId: string, chatJid: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM wa_allowlist WHERE account_id = ? AND chat_jid = ?")
    .get(accountId, chatJid);
  return Boolean(row);
}

export function listAllowlist(accountId?: string): Array<{
  account_id: string;
  chat_jid: string;
  label: string;
}> {
  if (accountId) {
    return getDb()
      .prepare("SELECT account_id, chat_jid, label FROM wa_allowlist WHERE account_id = ? ORDER BY label")
      .all(accountId) as Array<{ account_id: string; chat_jid: string; label: string }>;
  }
  return getDb()
    .prepare("SELECT account_id, chat_jid, label FROM wa_allowlist ORDER BY account_id, label")
    .all() as Array<{ account_id: string; chat_jid: string; label: string }>;
}

export function upsertAllow(accountId: string, chatJid: string, label: string): void {
  getDb()
    .prepare(
      `INSERT INTO wa_allowlist (account_id, chat_jid, label) VALUES (?,?,?)
       ON CONFLICT(account_id, chat_jid) DO UPDATE SET label = excluded.label`
    )
    .run(accountId, chatJid.trim(), label.trim());
}

export function removeAllow(accountId: string, chatJid: string): void {
  getDb().prepare("DELETE FROM wa_allowlist WHERE account_id = ? AND chat_jid = ?").run(accountId, chatJid);
}

function tableColumns(bridge: Database.Database, table: string): Set<string> {
  const rows = bridge.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function pickTable(bridge: Database.Database, names: string[]): string | null {
  const tables = bridge
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all() as Array<{ name: string }>;
  const set = new Set(tables.map((t) => t.name.toLowerCase()));
  for (const n of names) {
    if (set.has(n.toLowerCase())) return n;
  }
  return null;
}

export function ingestWhatsappDb(accountId: string, dbPath: string): { inserted: number } {
  const allow = listAllowlist(accountId);
  const allowed = new Set(allow.map((a) => a.chat_jid));
  if (!allowed.size) return { inserted: 0 };

  const bridge = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const table = pickTable(bridge, ["messages", "message"]);
    if (!table) return { inserted: 0 };
    const cols = tableColumns(bridge, table);
    const chatCol = ["chat_jid", "chatJid", "jid", "chat_id"].find((c) => cols.has(c));
    const idCol = ["id", "message_id", "msg_id"].find((c) => cols.has(c));
    const tsCol = ["timestamp", "ts", "time"].find((c) => cols.has(c));
    const bodyCol = ["content", "text", "body", "message"].find((c) => cols.has(c));
    const senderCol = ["sender", "sender_jid", "from"].find((c) => cols.has(c));
    const fromMeCol = ["is_from_me", "from_me", "fromMe"].find((c) => cols.has(c));
    if (!chatCol || !idCol || !tsCol) return { inserted: 0 };

    const select = `SELECT ${chatCol} AS chat_jid, ${idCol} AS msg_id, ${tsCol} AS ts
      ${bodyCol ? `, ${bodyCol} AS body` : `, '' AS body`}
      ${senderCol ? `, ${senderCol} AS sender` : `, '' AS sender`}
      ${fromMeCol ? `, ${fromMeCol} AS from_me` : `, 0 AS from_me`}
      FROM ${table}`;

    const rawRows = bridge.prepare(select).all() as Array<{
      chat_jid: string;
      msg_id: string;
      ts: number;
      body: string;
      sender: string;
      from_me: number | boolean;
    }>;
    const rows = filterAllowedJids(allowed, rawRows);

    const insert = getDb().prepare(
      `INSERT OR IGNORE INTO wa_messages (account_id, chat_jid, msg_id, ts, sender, body, from_me)
       VALUES (?,?,?,?,?,?,?)`
    );
    let inserted = 0;
    for (const row of rows) {
      const jid = String(row.chat_jid ?? "");
      const ts = Number(row.ts);
      const tsMs = ts < 1e12 ? ts * 1000 : ts;
      const info = insert.run(
        accountId,
        jid,
        String(row.msg_id),
        tsMs,
        String(row.sender ?? ""),
        String(row.body ?? ""),
        row.from_me ? 1 : 0
      );
      if (info.changes > 0) inserted += 1;
    }
    return { inserted };
  } finally {
    bridge.close();
  }
}
