import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Account } from "./accounts.js";
import { ensureFreshAccessToken } from "./mail-oauth.js";

export interface ConnTestResult {
  ok: boolean;
  imap: { ok: boolean; detail: string };
  smtp: { ok: boolean; detail: string };
  folders?: {
    drafts: string | null;
    sent: string | null;
    draftsChanged: boolean;
    sentChanged: boolean;
    available: string[];
  };
}

const DRAFT_NAMES = [
  "drafts",
  "draft",
  "rascunhos",
  "rascunho",
  "brouillons",
  "bozze",
];
const SENT_NAMES = [
  "sent",
  "sent messages",
  "sent items",
  "sent mail",
  "enviados",
  "enviadas",
  "itens enviados",
  "messages envoyés",
  "inviata",
  "inviate",
];

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function pickFolder(
  boxes: Array<{ path: string; specialUse?: string | false }>,
  special: string,
  nameHints: string[]
): string | null {
  const bySpecial = boxes.find((b) => b.specialUse === special);
  if (bySpecial) return bySpecial.path;
  for (const hint of nameHints) {
    const hit = boxes.find((b) => {
      const p = norm(b.path);
      const leaf = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
      return leaf === hint || p === hint || p.endsWith("/" + hint);
    });
    if (hit) return hit.path;
  }
  return null;
}

function humanizeAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/5\.7\.139|basic authentication is disabled/i.test(msg)) {
    return (
      `${msg} — a Microsoft rejeitou a senha de aplicação nesta conta (basic auth desactivado). ` +
      `Confirma IMAP activo em outlook.live.com → Definições → Correio → Sincronizar email, e que a senha de aplicação é recente (sem espaços).`
    );
  }
  if (/Invalid login|AUTHENTICATIONFAILED|Command failed/i.test(msg)) {
    return `${msg} — verifica o email completo e a senha de aplicação (não a password normal).`;
  }
  return msg;
}

function imapAuth(account: Account): { user: string; pass?: string; accessToken?: string } {
  if (account.authType === "oauth2" && account.oauth?.accessToken) {
    return { user: account.imap.user, accessToken: account.oauth.accessToken };
  }
  return { user: account.imap.user, pass: account.imap.pass };
}

function smtpAuth(account: Account): {
  type?: string;
  user: string;
  pass?: string;
  accessToken?: string;
} {
  if (account.authType === "oauth2" && account.oauth?.accessToken) {
    return {
      type: "OAuth2",
      user: account.smtp.user,
      accessToken: account.oauth.accessToken,
    };
  }
  return { user: account.smtp.user, pass: account.smtp.pass };
}

export async function testMailConnections(account: Account): Promise<ConnTestResult> {
  let acc = account;
  if (acc.authType === "oauth2") {
    try {
      acc = await ensureFreshAccessToken(acc);
    } catch (err) {
      const detail = humanizeAuthError(err);
      return {
        ok: false,
        imap: { ok: false, detail },
        smtp: { ok: false, detail },
      };
    }
  }
  const imap = await testImap(acc);
  const smtp = await testSmtp(acc);
  return {
    ok: imap.ok && smtp.ok,
    imap: { ok: imap.ok, detail: imap.detail },
    smtp,
    folders: imap.folders,
  };
}

async function testImap(account: Account): Promise<{
  ok: boolean;
  detail: string;
  folders?: ConnTestResult["folders"];
}> {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.tls,
    auth: imapAuth(account),
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  });
  try {
    await client.connect();
    const boxes = await client.list();
    const listed = boxes.map((b) => ({
      path: b.path,
      specialUse: (b.specialUse as string | false | undefined) ?? false,
    }));
    const detectedDrafts = pickFolder(listed, "\\Drafts", DRAFT_NAMES);
    const detectedSent = pickFolder(listed, "\\Sent", SENT_NAMES);
    const configuredDrafts = account.mail.draftsFolder || "Drafts";
    const configuredSent = account.mail.sentFolder || "Sent";

    const draftsExists = listed.some((b) => b.path === configuredDrafts);
    const sentExists = listed.some((b) => b.path === configuredSent);

    const draftsFinal = draftsExists ? configuredDrafts : detectedDrafts ?? configuredDrafts;
    const sentFinal = sentExists ? configuredSent : detectedSent ?? configuredSent;

    const draftsChanged = draftsFinal !== configuredDrafts;
    const sentChanged = sentFinal !== configuredSent;

    const names = listed.slice(0, 10).map((b) => b.path).join(", ");
    const corrections: string[] = [];
    if (draftsChanged) corrections.push(`Drafts → “${draftsFinal}”`);
    if (sentChanged) corrections.push(`Sent → “${sentFinal}”`);

    await client.logout().catch(() => undefined);
    return {
      ok: true,
      detail:
        `Ligação OK (${listed.length} pastas` +
        (names ? `: ${names}` : "") +
        ")" +
        (corrections.length ? `. Pastas corrigidas: ${corrections.join("; ")}` : ""),
      folders: {
        drafts: draftsFinal,
        sent: sentFinal,
        draftsChanged,
        sentChanged,
        available: listed.map((b) => b.path),
      },
    };
  } catch (err) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    return { ok: false, detail: humanizeAuthError(err) };
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
    auth: smtpAuth(account),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 20_000,
  } as Parameters<typeof nodemailer.createTransport>[0]);
  try {
    await transport.verify();
    return { ok: true, detail: "Ligação OK (AUTH aceite)" };
  } catch (err) {
    return { ok: false, detail: humanizeAuthError(err) };
  } finally {
    transport.close();
  }
}
