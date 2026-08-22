import { getDb } from "./db.js";
import { commsConfig } from "./config.js";
import {
  issuerLinesFromFromHeader,
  mergeWhitelistLines,
  recipientLinesNonEmpty,
  type InvoiceStage,
} from "./mail/invoice-whitelist.js";

const MAIL_MAX_AGE = "mail_max_age_days";
const TENANT = "s3_tenant_id";
const STAGE = "invoice_whitelist_stage";
const ISSUERS = "invoice_issuers";
const RECIPIENTS = "invoice_recipients";
const SEED_DONE = "invoice_seed_done";
const ISSUERS_FROM_IMPORT = "invoice_issuers_from_import";

export const TENANT_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function getSetting(key: string, fallback: string): string {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function mailMaxAgeDays(): number {
  const n = Number(getSetting(MAIL_MAX_AGE, "365"));
  if (!Number.isFinite(n) || n < 1) return 365;
  return Math.min(3650, Math.round(n));
}

export function setMailMaxAgeDays(days: number): void {
  setSetting(MAIL_MAX_AGE, String(mailMaxAgeDaysClamp(days)));
}

export function mailMaxAgeDaysClamp(days: number): number {
  if (!Number.isFinite(days) || days < 1) return 365;
  return Math.min(3650, Math.round(days));
}

export function mailCutoffMs(): number {
  return Date.now() - mailMaxAgeDays() * 24 * 60 * 60 * 1000;
}

export function s3TenantId(): string {
  return getSetting(TENANT, "").trim().toLowerCase();
}

export function setS3TenantId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (!TENANT_RE.test(id)) {
    throw new Error("Identificador do cliente inválido (só a-z, 0-9 e hífen).");
  }
  setSetting(TENANT, id);
  return id;
}

export function invoiceIssuers(): string {
  return getSetting(ISSUERS, "");
}

export function invoiceRecipients(): string {
  return getSetting(RECIPIENTS, "");
}

export function invoiceStage(): InvoiceStage {
  const v = getSetting(STAGE, "seed");
  if (v === "review" || v === "active" || v === "seed") return v;
  return "seed";
}

export function setInvoiceLists(issuers: string, recipients: string): void {
  setSetting(ISSUERS, issuers);
  setSetting(RECIPIENTS, recipients);
  if (recipientLinesNonEmpty(recipients)) {
    setSetting(STAGE, "active");
    return;
  }
  if (getSetting(SEED_DONE, "") === "1") setSetting(STAGE, "review");
  else setSetting(STAGE, "seed");
}

export function markInvoiceSeedDone(): void {
  if (getSetting(SEED_DONE, "") === "1") return;
  setSetting(SEED_DONE, "1");
  if (!recipientLinesNonEmpty(invoiceRecipients())) setSetting(STAGE, "review");
}

/** One-shot: fill issuer whitelist from From of messages already stored as invoices. */
export function seedIssuersFromImportedInvoices(): { added: number; total: number } | null {
  if (getSetting(ISSUERS_FROM_IMPORT, "") === "1") return null;
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT m.from_header AS from_header
       FROM invoices i
       JOIN mail_messages m ON m.id = i.mail_message_pk
       WHERE m.from_header IS NOT NULL AND TRIM(m.from_header) != ''`
    )
    .all() as Array<{ from_header: string }>;
  const extra = rows.flatMap((r) => issuerLinesFromFromHeader(r.from_header));
  if (!extra.length) return null;
  const merged = mergeWhitelistLines(invoiceIssuers(), extra);
  setSetting(ISSUERS, merged);
  setSetting(ISSUERS_FROM_IMPORT, "1");
  markInvoiceSeedDone();
  const total = merged ? merged.split(/\n/).filter(Boolean).length : 0;
  return { added: extra.length, total };
}

export function s3CredentialsOk(): boolean {
  const s = commsConfig.s3;
  return Boolean(s.endpoint && s.bucket && s.accessKey && s.secretKey);
}

/** Null if mail attachment jobs may run. */
export function mailAttachmentGateError(): string | null {
  const tenant = s3TenantId();
  if (!tenant || !TENANT_RE.test(tenant)) {
    return "Grava o identificador do cliente em Definições antes de actualizar o correio ou descarregar anexos.";
  }
  if (!s3CredentialsOk()) {
    return "O armazenamento S3 não está configurado no servidor (chaves Euronodes). Os anexos não podem ser guardados.";
  }
  return null;
}
