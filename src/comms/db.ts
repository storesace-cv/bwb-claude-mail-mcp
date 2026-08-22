import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { commsConfig } from "./config.js";
import { seedInitialIfEmpty } from "./rules/seed-initial.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(path.dirname(commsConfig.dbPath), { recursive: true, mode: 0o700 });
  db = new Database(commsConfig.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedInitialIfEmpty();
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS mail_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      folder TEXT NOT NULL,
      uid INTEGER NOT NULL,
      uidvalidity INTEGER NOT NULL DEFAULT 0,
      message_id TEXT,
      in_reply_to TEXT,
      thread_key TEXT NOT NULL,
      from_header TEXT NOT NULL DEFAULT '',
      to_header TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      date_ms INTEGER NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      seen INTEGER NOT NULL DEFAULT 0,
      UNIQUE (account_id, folder, uidvalidity, uid)
    );
    CREATE INDEX IF NOT EXISTS idx_mail_thread ON mail_messages (account_id, thread_key);
    CREATE INDEX IF NOT EXISTS idx_mail_mid ON mail_messages (account_id, message_id);

    CREATE TABLE IF NOT EXISTS mail_threads (
      account_id TEXT NOT NULL,
      thread_key TEXT NOT NULL,
      last_inbound_at INTEGER,
      last_outbound_at INTEGER,
      unanswered INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (account_id, thread_key)
    );
    CREATE INDEX IF NOT EXISTS idx_unanswered ON mail_threads (unanswered);

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      mail_message_pk INTEGER,
      filename TEXT NOT NULL,
      sha256 TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      mime TEXT NOT NULL,
      extracted_text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_messages (
      account_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      msg_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      sender TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      from_me INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, chat_jid, msg_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wa_chat ON wa_messages (account_id, chat_jid, ts);

    CREATE TABLE IF NOT EXISTS wa_allowlist (
      account_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (account_id, chat_jid)
    );

    CREATE TABLE IF NOT EXISTS kb_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      solution TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_cursors (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mail_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '*',
      match_from TEXT NOT NULL DEFAULT '',
      match_subject TEXT NOT NULL DEFAULT '',
      subject_prefix TEXT NOT NULL DEFAULT '',
      from_domain TEXT NOT NULL DEFAULT '',
      dest_folder TEXT NOT NULL DEFAULT '',
      split_promo INTEGER NOT NULL DEFAULT 0,
      catch_promo INTEGER NOT NULL DEFAULT 0,
      catch_digest INTEGER NOT NULL DEFAULT 0,
      odoo_notifications INTEGER NOT NULL DEFAULT 0,
      catch_invoice INTEGER NOT NULL DEFAULT 0,
      catch_security INTEGER NOT NULL DEFAULT 0,
      purge_after_days INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS wa_watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '',
      kb_enabled INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE (account_id, chat_jid)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      job TEXT NOT NULL,
      hour INTEGER NOT NULL,
      weekdays_only INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS mail_folders (
      account_id TEXT NOT NULL,
      path TEXT NOT NULL,
      PRIMARY KEY (account_id, path)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateWaWatchGroups(database);
  const days = database.prepare("SELECT value FROM app_settings WHERE key = 'mail_max_age_days'").get() as
    | { value: string }
    | undefined;
  if (!days) {
    database.prepare("INSERT INTO app_settings (key, value) VALUES ('mail_max_age_days', '365')").run();
  }
  const tenant = database.prepare("SELECT value FROM app_settings WHERE key = 's3_tenant_id'").get() as
    | { value: string }
    | undefined;
  if (!tenant) {
    database.prepare("INSERT INTO app_settings (key, value) VALUES ('s3_tenant_id', 'jorgepeixinho')").run();
  }
  const stage = database.prepare("SELECT value FROM app_settings WHERE key = 'invoice_whitelist_stage'").get() as
    | { value: string }
    | undefined;
  if (!stage) {
    database.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_whitelist_stage', 'seed')").run();
  }
}

export function getCursor(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM job_cursors WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setCursor(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO job_cursors (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function closeDb(): void {
  db?.close();
  db = null;
}

function tableColumns(database: Database.Database, table: string): Set<string> {
  return new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
  );
}

/** One vigia, many chats. Merges rows that shared keywords/KB/enabled. */
function migrateWaWatchGroups(database: Database.Database): void {
  const cols = tableColumns(database, "wa_watches");
  if (!cols.has("chat_jid")) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS wa_watch_chats (
        watch_id INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (account_id, chat_jid)
      );
    `);
    return;
  }

  database.transaction(() => {
    database.exec(`
      CREATE TABLE wa_watches_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        keywords TEXT NOT NULL DEFAULT '',
        kb_enabled INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS wa_watch_chats (
        watch_id INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (account_id, chat_jid)
      );
    `);

    const old = database
      .prepare("SELECT * FROM wa_watches ORDER BY id")
      .all() as Array<{
      id: number;
      account_id: string;
      chat_jid: string;
      label: string;
      keywords: string;
      kb_enabled: number;
      enabled: number;
    }>;

    const groups = new Map<string, typeof old>();
    for (const row of old) {
      const key = `${row.keywords}\n${row.kb_enabled}\n${row.enabled}`;
      const g = groups.get(key) ?? [];
      g.push(row);
      groups.set(key, g);
    }

    const insertWatch = database.prepare(
      `INSERT INTO wa_watches_new (id, name, keywords, kb_enabled, enabled) VALUES (?,?,?,?,?)`
    );
    const insertChat = database.prepare(
      `INSERT OR IGNORE INTO wa_watch_chats (watch_id, account_id, chat_jid, label) VALUES (?,?,?,?)`
    );

    for (const group of groups.values()) {
      const keep = group[0];
      const labels = [...new Set(group.map((r) => r.label).filter(Boolean))];
      const name = labels.length === 1 ? labels[0] : labels[0] || "Vigia";
      insertWatch.run(keep.id, name, keep.keywords, keep.kb_enabled, keep.enabled);
      for (const row of group) {
        insertChat.run(keep.id, row.account_id, row.chat_jid, row.label);
      }
    }

    database.exec(`
      DROP TABLE wa_watches;
      ALTER TABLE wa_watches_new RENAME TO wa_watches;
    `);
  })();
}
