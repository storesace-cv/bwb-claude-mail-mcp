import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Account } from "./accounts.js";

export interface ConnTestResult {
  ok: boolean;
  imap: { ok: boolean; detail: string };
  smtp: { ok: boolean; detail: string };
}

export async function testMailConnections(account: Account): Promise<ConnTestResult> {
  const imap = await testImap(account);
  const smtp = await testSmtp(account);
  return { ok: imap.ok && smtp.ok, imap, smtp };
}

async function testImap(account: Account): Promise<{ ok: boolean; detail: string }> {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.tls,
    auth: { user: account.imap.user, pass: account.imap.pass },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  try {
    await client.connect();
    const boxes = await client.list();
    const names = boxes.slice(0, 8).map((b) => b.path).join(", ");
    await client.logout().catch(() => undefined);
    return {
      ok: true,
      detail: `Ligação OK (${boxes.length} pastas${names ? `: ${names}` : ""})`,
    };
  } catch (err) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function testSmtp(account: Account): Promise<{ ok: boolean; detail: string }> {
  const port = account.smtp.port;
  const secure = account.smtp.tls && port === 465;
  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port,
    secure,
    requireTLS: !secure && account.smtp.tls,
    auth: { user: account.smtp.user, pass: account.smtp.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.verify();
    return { ok: true, detail: "Ligação OK (AUTH aceite)" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.close();
  }
}
