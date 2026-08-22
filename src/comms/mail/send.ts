import nodemailer from "nodemailer";
import { listMailAccounts, type MailAccount } from "../accounts.js";
import { commsConfig } from "../config.js";
import { ensureFreshAccessToken, smtpAuth } from "../oauth.js";

export async function sendCommsMail(subject: string, text: string): Promise<void> {
  const accounts = await listMailAccounts();
  const defaultAcc = accounts.find((a) => a.default) ?? accounts[0];
  if (!defaultAcc) throw new Error("Sem contas de mail");
  await sendFromAccount(defaultAcc, subject, text);
}

export async function sendFromAccount(
  account: MailAccount,
  subject: string,
  text: string
): Promise<void> {
  const acc = await ensureFreshAccessToken(account);
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
      subject,
      text,
    });
  } finally {
    transport.close();
  }
}
