import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface ImapCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls: boolean;
}

export interface SmtpCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls: boolean;
}

export interface CalDavCreds {
  url: string;
  user: string;
  pass: string;
}

export interface MailDefaults {
  defaultFrom: string;
  defaultFromName?: string;
  draftsFolder: string;
  sentFolder: string | null;
}

export interface Account {
  id: string;
  label: string;
  default?: boolean;
  imap: ImapCreds;
  smtp: SmtpCreds;
  mail: MailDefaults;
  caldav?: CalDavCreds;
}

export interface AccountsFile {
  version: 1;
  accounts: Account[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function readFile(): Promise<AccountsFile> {
  try {
    const raw = await fs.readFile(config.accountsFile, "utf8");
    const parsed = JSON.parse(raw) as AccountsFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      throw new Error("Invalid accounts.json");
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, accounts: [] };
    }
    throw err;
  }
}

async function writeFile(data: AccountsFile): Promise<void> {
  await fs.mkdir(path.dirname(config.accountsFile), { recursive: true });
  const tmp = `${config.accountsFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, config.accountsFile);
  await fs.chmod(config.accountsFile, 0o600);
}

export async function listAccounts(): Promise<Account[]> {
  return (await readFile()).accounts;
}

export async function getAccount(id: string): Promise<Account | undefined> {
  return (await readFile()).accounts.find((a) => a.id === id);
}

export function validateAccountInput(raw: Record<string, unknown>, opts?: { keepPass?: Account }): Account {
  const id = String(raw.id ?? "").trim();
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid id (expected ${ID_PATTERN})`);
  }
  const label = String(raw.label ?? "").trim();
  if (!label) throw new Error("Label is required");

  const imapPass =
    String(raw.imap_pass ?? "").trim() ||
    (opts?.keepPass?.imap.pass ?? "");
  const smtpPass =
    String(raw.smtp_pass ?? "").trim() ||
    (opts?.keepPass?.smtp.pass ?? "");
  if (!imapPass) throw new Error("IMAP password is required");
  if (!smtpPass) throw new Error("SMTP password is required");

  const account: Account = {
    id,
    label,
    default: raw.default === true || raw.default === "on" || raw.default === "true",
    imap: {
      host: String(raw.imap_host ?? "").trim(),
      port: Number(raw.imap_port ?? 993),
      user: String(raw.imap_user ?? "").trim(),
      pass: imapPass,
      tls: raw.imap_tls !== "false" && raw.imap_tls !== false,
    },
    smtp: {
      host: String(raw.smtp_host ?? "").trim(),
      port: Number(raw.smtp_port ?? 465),
      user: String(raw.smtp_user ?? "").trim(),
      pass: smtpPass,
      tls: raw.smtp_tls !== "false" && raw.smtp_tls !== false,
    },
    mail: {
      defaultFrom: String(raw.default_from ?? "").trim(),
      defaultFromName: String(raw.default_from_name ?? "").trim() || undefined,
      draftsFolder: String(raw.drafts_folder ?? "Drafts").trim() || "Drafts",
      sentFolder: String(raw.sent_folder ?? "Sent").trim() || null,
    },
  };

  if (!account.imap.host || !account.imap.user) throw new Error("IMAP host/user required");
  if (!account.smtp.host || !account.smtp.user) throw new Error("SMTP host/user required");
  if (!account.mail.defaultFrom) throw new Error("Default From is required");

  const caldavUrl = String(raw.caldav_url ?? "").trim();
  if (caldavUrl) {
    account.caldav = {
      url: caldavUrl,
      user: String(raw.caldav_user ?? account.imap.user).trim(),
      pass: String(raw.caldav_pass ?? "").trim() || opts?.keepPass?.caldav?.pass || account.imap.pass,
    };
  }

  return account;
}

export async function upsertAccount(account: Account): Promise<void> {
  const data = await readFile();
  const idx = data.accounts.findIndex((a) => a.id === account.id);
  if (account.default) {
    data.accounts = data.accounts.map((a) => ({ ...a, default: false }));
  }
  if (idx >= 0) data.accounts[idx] = account;
  else data.accounts.push(account);
  if (data.accounts.length === 1) data.accounts[0].default = true;
  if (!data.accounts.some((a) => a.default) && data.accounts[0]) {
    data.accounts[0].default = true;
  }
  await writeFile(data);
}

export async function deleteAccount(id: string): Promise<void> {
  const data = await readFile();
  data.accounts = data.accounts.filter((a) => a.id !== id);
  if (data.accounts.length && !data.accounts.some((a) => a.default)) {
    data.accounts[0].default = true;
  }
  await writeFile(data);
}

export async function setDefaultAccount(id: string): Promise<void> {
  const data = await readFile();
  if (!data.accounts.some((a) => a.id === id)) throw new Error("Account not found");
  data.accounts = data.accounts.map((a) => ({ ...a, default: a.id === id }));
  await writeFile(data);
}

export async function ensureEmptyAccountsFile(): Promise<void> {
  try {
    await fs.access(config.accountsFile);
  } catch {
    await writeFile({ version: 1, accounts: [] });
  }
}
