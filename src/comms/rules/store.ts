import { getDb } from "../db.js";

export interface MailRule {
  id: number;
  name: string;
  kind: string;
  accountId: string;
  matchFrom: string;
  matchSubject: string;
  subjectPrefix: string;
  fromDomain: string;
  destFolder: string;
  splitPromo: boolean;
  catchPromo: boolean;
  catchDigest: boolean;
  odooNotifications: boolean;
  catchInvoice: boolean;
  catchSecurity: boolean;
  purgeAfterDays: number;
  enabled: boolean;
}

export interface WaWatchChat {
  accountId: string;
  chatJid: string;
  label: string;
}

export interface WaWatch {
  id: number;
  name: string;
  keywords: string;
  kbEnabled: boolean;
  enabled: boolean;
  chats: WaWatchChat[];
}

export interface Schedule {
  id: string;
  title: string;
  job: string;
  hour: number;
  weekdaysOnly: boolean;
  enabled: boolean;
}

function mapRule(r: Record<string, unknown>): MailRule {
  return {
    id: Number(r.id),
    name: String(r.name),
    kind: String(r.kind),
    accountId: String(r.account_id),
    matchFrom: String(r.match_from ?? ""),
    matchSubject: String(r.match_subject ?? ""),
    subjectPrefix: String(r.subject_prefix ?? ""),
    fromDomain: String(r.from_domain ?? ""),
    destFolder: String(r.dest_folder ?? ""),
    splitPromo: Boolean(r.split_promo),
    catchPromo: Boolean(r.catch_promo),
    catchDigest: Boolean(r.catch_digest),
    odooNotifications: Boolean(r.odoo_notifications),
    catchInvoice: Boolean(r.catch_invoice),
    catchSecurity: Boolean(r.catch_security),
    purgeAfterDays: Number(r.purge_after_days ?? 0),
    enabled: Boolean(r.enabled),
  };
}

export function listMailRules(enabledOnly = false): MailRule[] {
  const sql = enabledOnly
    ? "SELECT * FROM mail_rules WHERE enabled = 1 ORDER BY id"
    : "SELECT * FROM mail_rules ORDER BY id";
  return (getDb().prepare(sql).all() as Record<string, unknown>[]).map(mapRule);
}

export function getMailRule(id: number): MailRule | undefined {
  const r = getDb().prepare("SELECT * FROM mail_rules WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? mapRule(r) : undefined;
}

export function insertMailRule(r: Omit<MailRule, "id">): number {
  const info = getDb()
    .prepare(
      `INSERT INTO mail_rules (
        name, kind, account_id, match_from, match_subject, subject_prefix, from_domain,
        dest_folder, split_promo, catch_promo, catch_digest, odoo_notifications,
        catch_invoice, catch_security, purge_after_days, enabled
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      r.name,
      r.kind,
      r.accountId,
      r.matchFrom,
      r.matchSubject,
      r.subjectPrefix,
      r.fromDomain,
      r.destFolder,
      r.splitPromo ? 1 : 0,
      r.catchPromo ? 1 : 0,
      r.catchDigest ? 1 : 0,
      r.odooNotifications ? 1 : 0,
      r.catchInvoice ? 1 : 0,
      r.catchSecurity ? 1 : 0,
      r.purgeAfterDays,
      r.enabled ? 1 : 0
    );
  return Number(info.lastInsertRowid);
}

export function duplicateMailRule(id: number): number | undefined {
  const src = getMailRule(id);
  if (!src) return undefined;
  const { id: _omit, ...rest } = src;
  return insertMailRule({
    ...rest,
    name: `${src.name} (cópia)`,
  });
}

export function updateMailRule(r: MailRule): void {
  getDb()
    .prepare(
      `UPDATE mail_rules SET name=?, kind=?, account_id=?, match_from=?, match_subject=?,
       subject_prefix=?, from_domain=?, dest_folder=?, split_promo=?, catch_promo=?,
       catch_digest=?, odoo_notifications=?, catch_invoice=?, catch_security=?,
       purge_after_days=?, enabled=? WHERE id=?`
    )
    .run(
      r.name,
      r.kind,
      r.accountId,
      r.matchFrom,
      r.matchSubject,
      r.subjectPrefix,
      r.fromDomain,
      r.destFolder,
      r.splitPromo ? 1 : 0,
      r.catchPromo ? 1 : 0,
      r.catchDigest ? 1 : 0,
      r.odooNotifications ? 1 : 0,
      r.catchInvoice ? 1 : 0,
      r.catchSecurity ? 1 : 0,
      r.purgeAfterDays,
      r.enabled ? 1 : 0,
      r.id
    );
}

export function deleteMailRule(id: number): void {
  getDb().prepare("DELETE FROM mail_rules WHERE id = ?").run(id);
}

export function setMailRuleEnabled(id: number, enabled: boolean): void {
  getDb().prepare("UPDATE mail_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function listSchedules(): Schedule[] {
  return (
    getDb().prepare("SELECT * FROM schedules ORDER BY hour, id").all() as Array<{
      id: string;
      title: string;
      job: string;
      hour: number;
      weekdays_only: number;
      enabled: number;
    }>
  ).map((s) => ({
    id: s.id,
    title: s.title,
    job: s.job,
    hour: s.hour,
    weekdaysOnly: Boolean(s.weekdays_only),
    enabled: Boolean(s.enabled),
  }));
}

export function getSchedule(id: string): Schedule | undefined {
  return listSchedules().find((s) => s.id === id);
}

export function updateSchedule(s: Schedule): void {
  getDb()
    .prepare(
      `UPDATE schedules SET title=?, job=?, hour=?, weekdays_only=?, enabled=? WHERE id=?`
    )
    .run(s.title, s.job, s.hour, s.weekdaysOnly ? 1 : 0, s.enabled ? 1 : 0, s.id);
}

export function listWaWatches(): WaWatch[] {
  const watches = (
    getDb().prepare("SELECT * FROM wa_watches ORDER BY name, id").all() as Array<{
      id: number;
      name: string;
      keywords: string;
      kb_enabled: number;
      enabled: number;
    }>
  ).map((w) => ({
    id: w.id,
    name: w.name,
    keywords: w.keywords,
    kbEnabled: Boolean(w.kb_enabled),
    enabled: Boolean(w.enabled),
    chats: [] as WaWatchChat[],
  }));
  const chats = getDb()
    .prepare("SELECT watch_id, account_id, chat_jid, label FROM wa_watch_chats ORDER BY label")
    .all() as Array<{ watch_id: number; account_id: string; chat_jid: string; label: string }>;
  const byId = new Map(watches.map((w) => [w.id, w]));
  for (const c of chats) {
    const w = byId.get(c.watch_id);
    if (!w) continue;
    w.chats.push({ accountId: c.account_id, chatJid: c.chat_jid, label: c.label });
  }
  return watches;
}

export function getWaWatch(id: number): WaWatch | undefined {
  return listWaWatches().find((w) => w.id === id);
}

export function insertWaWatch(w: Omit<WaWatch, "id">): number {
  const db = getDb();
  return db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO wa_watches (name, keywords, kb_enabled, enabled) VALUES (?,?,?,?)`)
      .run(w.name, w.keywords, w.kbEnabled ? 1 : 0, w.enabled ? 1 : 0);
    const id = Number(info.lastInsertRowid);
    replaceWatchChats(id, w.chats);
    return id;
  })();
}

export function updateWaWatch(w: WaWatch): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE wa_watches SET name=?, keywords=?, kb_enabled=?, enabled=? WHERE id=?`).run(
      w.name,
      w.keywords,
      w.kbEnabled ? 1 : 0,
      w.enabled ? 1 : 0,
      w.id
    );
    replaceWatchChats(w.id, w.chats);
  })();
}

export function setWaWatchEnabled(id: number, enabled: boolean): void {
  getDb().prepare("UPDATE wa_watches SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteWaWatch(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM wa_watch_chats WHERE watch_id = ?").run(id);
    db.prepare("DELETE FROM wa_watches WHERE id = ?").run(id);
  })();
}

function replaceWatchChats(watchId: number, chats: WaWatchChat[]): void {
  const db = getDb();
  db.prepare("DELETE FROM wa_watch_chats WHERE watch_id = ?").run(watchId);
  const ins = db.prepare(
    `INSERT INTO wa_watch_chats (watch_id, account_id, chat_jid, label) VALUES (?,?,?,?)`
  );
  for (const c of chats) {
    ins.run(watchId, c.accountId, c.chatJid, c.label);
  }
}

export function replaceMailFolders(accountId: string, paths: string[]): void {
  const db = getDb();
  db.prepare("DELETE FROM mail_folders WHERE account_id = ?").run(accountId);
  const ins = db.prepare("INSERT INTO mail_folders (account_id, path) VALUES (?,?)");
  for (const p of paths) ins.run(accountId, p);
}

export function listCachedFolders(accountId?: string): string[] {
  if (accountId && accountId !== "*") {
    return (
      getDb()
        .prepare("SELECT path FROM mail_folders WHERE account_id = ? ORDER BY path")
        .all(accountId) as Array<{ path: string }>
    ).map((r) => r.path);
  }
  const rows = getDb()
    .prepare("SELECT DISTINCT path FROM mail_folders ORDER BY path")
    .all() as Array<{ path: string }>;
  return rows.map((r) => r.path);
}
