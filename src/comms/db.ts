import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { commsConfig } from "./config.js";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(path.dirname(commsConfig.dbPath), { recursive: true, mode: 0o700 });
  db = new DatabaseSync(commsConfig.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: DatabaseSync): void {
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
  `);
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
