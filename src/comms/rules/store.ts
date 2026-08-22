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

export interface WaWatch {
  id: number;
  accountId: string;
  chatJid: string;
  label: string;
  keywords: string;
  kbEnabled: boolean;
  enabled: boolean;
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
  return (
    getDb().prepare("SELECT * FROM wa_watches ORDER BY label").all() as Array<{
      id: number;
      account_id: string;
      chat_jid: string;
      label: string;
      keywords: string;
      kb_enabled: number;
      enabled: number;
    }>
  ).map((w) => ({
    id: w.id,
    accountId: w.account_id,
    chatJid: w.chat_jid,
    label: w.label,
    keywords: w.keywords,
    kbEnabled: Boolean(w.kb_enabled),
    enabled: Boolean(w.enabled),
  }));
}

export function upsertWaWatch(w: {
  accountId: string;
  chatJid: string;
  label: string;
  keywords: string;
  kbEnabled: boolean;
  enabled: boolean;
}): void {
  getDb()
    .prepare(
      `INSERT INTO wa_watches (account_id, chat_jid, label, keywords, kb_enabled, enabled)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(account_id, chat_jid) DO UPDATE SET
         label=excluded.label, keywords=excluded.keywords,
         kb_enabled=excluded.kb_enabled, enabled=excluded.enabled`
    )
    .run(
      w.accountId,
      w.chatJid,
      w.label,
      w.keywords,
      w.kbEnabled ? 1 : 0,
      w.enabled ? 1 : 0
    );
}

export function deleteWaWatch(id: number): void {
  getDb().prepare("DELETE FROM wa_watches WHERE id = ?").run(id);
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
