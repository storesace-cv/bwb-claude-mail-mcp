import nodemailer from "nodemailer";
import { listMailAccounts } from "../accounts.js";
import { commsConfig } from "../config.js";
import { getDb, getCursor, setCursor } from "../db.js";
import { ensureFreshAccessToken, smtpAuth } from "../oauth.js";

function todayKeyFrom(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function shouldSendDigest(now = new Date()): boolean {
  if (getCursor("digest:last") === todayKeyFrom(now)) return false;
  return now.getHours() >= commsConfig.digestHour;
}

export async function sendDigestIfDue(): Promise<{ sent: boolean }> {
  if (!shouldSendDigest()) return { sent: false };
  const accounts = await listMailAccounts();
  const defaultAcc = accounts.find((a) => a.default) ?? accounts[0];
  if (!defaultAcc) return { sent: false };

  const db = getDb();
  const unanswered = db
    .prepare(
      `SELECT account_id, subject, last_inbound_at FROM mail_threads WHERE unanswered = 1
       ORDER BY last_inbound_at DESC LIMIT 40`
    )
    .all() as Array<{ account_id: string; subject: string; last_inbound_at: number | null }>;
  const invoices = db
    .prepare(`SELECT filename, created_at FROM invoices ORDER BY created_at DESC LIMIT 20`)
    .all() as Array<{ filename: string; created_at: number }>;
  const wa = db
    .prepare(`SELECT COUNT(*) AS n FROM wa_messages WHERE ts > ?`)
    .get(Date.now() - 24 * 3600 * 1000) as { n: number };

  const lines = [
    `Digest BWB Comms — ${todayKeyFrom(new Date())}`,
    "",
    `Não respondidos: ${unanswered.length}`,
    ...unanswered.map(
      (u) =>
        `- [${u.account_id}] ${u.subject} (${u.last_inbound_at ? new Date(u.last_inbound_at).toISOString() : ""})`
    ),
    "",
    `Facturas recentes: ${invoices.length}`,
    ...invoices.map((i) => `- ${i.filename}`),
    "",
    `WhatsApp (allowlist, 24h): ${wa.n} mensagens`,
  ];

  const acc = await ensureFreshAccessToken(defaultAcc);
  const port = acc.smtp.port;
  const secure = acc.smtp.tls && port === 465;
  const transport = nodemailer.createTransport({
    host: acc.smtp.host,
    port,
    secure,
    requireTLS: !secure && acc.smtp.tls,
    auth: smtpAuth(acc),
  } as Parameters<typeof nodemailer.createTransport>[0]);

  const to = commsConfig.digestTo || acc.mail.defaultFrom;
  try {
    await transport.sendMail({
      from: acc.mail.defaultFrom,
      to,
      subject: `[BWB Comms] Digest ${todayKeyFrom(new Date())}`,
      text: lines.join("\n"),
    });
    setCursor("digest:last", todayKeyFrom(new Date()));
    return { sent: true };
  } finally {
    transport.close();
  }
}
