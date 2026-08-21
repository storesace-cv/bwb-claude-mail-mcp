import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import {
  applyProviderPreset,
  parseMailProvider,
  type MailAuthType,
  type MailProvider,
} from "./mail-providers.js";

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

export interface AccountOAuth {
  provider: "microsoft" | "google";
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  email: string;
}

export interface Account {
  id: string;
  label: string;
  default?: boolean;
  provider?: MailProvider;
  authType?: MailAuthType;
  imap: ImapCreds;
  smtp: SmtpCreds;
  mail: MailDefaults;
  caldav?: CalDavCreds;
  oauth?: AccountOAuth;
}

export interface AccountsFile {
  version: 1;
  accounts: Account[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function generateAccountId(seed: string, existingIds: string[]): string {
  let base = seed
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (!base) base = "account";
  if (!/^[a-z0-9]/.test(base)) base = `a${base}`.slice(0, 24);
  let id = base.slice(0, 32);
  let n = 2;
  while (existingIds.includes(id)) {
    const suffix = `-${n++}`;
    id = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
  }
  return id;
}

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

function normalizeAuthType(
  provider: MailProvider,
  raw: unknown,
  keep?: Account
): MailAuthType {
  const s = String(raw ?? "").toLowerCase();
  if (s === "oauth2" || s === "password") return s;
  if (keep?.authType) return keep.authType;
  if (provider === "microsoft" || provider === "google") return "oauth2";
  return "password";
}

export function validateAccountInput(
  raw: Record<string, unknown>,
  opts?: { keepPass?: Account; existingIds?: string[]; autoId?: boolean }
): Account {
  let id = String(raw.id ?? "").trim();
  if (!id && opts?.autoId) {
    const seed =
      String(raw.label ?? "").trim() ||
      String(raw.imap_user ?? "").trim() ||
      String(raw.default_from ?? "").trim() ||
      "account";
    id = generateAccountId(seed, opts.existingIds ?? []);
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid id (expected ${ID_PATTERN})`);
  }
  const label = String(raw.label ?? "").trim();
  if (!label) throw new Error("Label is required");

  const provider = parseMailProvider(raw.provider ?? opts?.keepPass?.provider);
  const authType = normalizeAuthType(provider, raw.auth_type ?? raw.authType, opts?.keepPass);
  const preset = applyProviderPreset(provider, {
    imap_host: String(raw.imap_host ?? ""),
    imap_port: raw.imap_port as string | number,
    smtp_host: String(raw.smtp_host ?? ""),
    smtp_port: raw.smtp_port as string | number,
  });

  const imapHost = String(raw.imap_host ?? "").trim() || preset.imap_host;
  const smtpHost = String(raw.smtp_host ?? "").trim() || preset.smtp_host;
  const imapPort = Number(raw.imap_port ?? preset.imap_port);
  const smtpPort = Number(raw.smtp_port ?? preset.smtp_port);

  const imapPass =
    String(raw.imap_pass ?? "").trim() || (opts?.keepPass?.imap.pass ?? "");
  const smtpPass =
    String(raw.smtp_pass ?? "").trim() || (opts?.keepPass?.smtp.pass ?? "");

  const oauthKeep = opts?.keepPass?.oauth;
  let oauth = oauthKeep;
  if (authType === "oauth2") {
    if (!oauth?.refreshToken) {
      throw new Error(
        provider === "google"
          ? "Conta Gmail: usa «Ligar com Google» antes de guardar (OAuth obrigatório)."
          : "Conta Microsoft: usa «Ligar com Microsoft» antes de guardar (OAuth obrigatório)."
      );
    }
  } else {
    oauth = undefined;
    if (!imapPass) throw new Error("IMAP password is required");
    if (!smtpPass) throw new Error("SMTP password is required");
  }

  const smtpTls = raw.smtp_tls !== "false" && raw.smtp_tls !== false;

  const account: Account = {
    id,
    label,
    default: raw.default === true || raw.default === "on" || raw.default === "true",
    provider,
    authType,
    imap: {
      host: imapHost,
      port: imapPort,
      user: String(raw.imap_user ?? "").trim(),
      pass: authType === "oauth2" ? "" : imapPass,
      tls: raw.imap_tls !== "false" && raw.imap_tls !== false,
    },
    smtp: {
      host: smtpHost,
      port: smtpPort,
      user: String(raw.smtp_user ?? "").trim(),
      pass: authType === "oauth2" ? "" : smtpPass,
      tls: smtpTls,
    },
    mail: {
      defaultFrom: String(raw.default_from ?? "").trim(),
      defaultFromName: String(raw.default_from_name ?? "").trim() || undefined,
      draftsFolder: String(raw.drafts_folder ?? "Drafts").trim() || "Drafts",
      sentFolder: String(raw.sent_folder ?? "Sent").trim() || null,
    },
  };

  if (oauth && authType === "oauth2") {
    account.oauth = oauth;
    if (!account.imap.user) account.imap.user = oauth.email;
    if (!account.smtp.user) account.smtp.user = oauth.email;
    if (!account.mail.defaultFrom) account.mail.defaultFrom = oauth.email;
  }

  if (!account.imap.host || !account.imap.user) throw new Error("IMAP host/user required");
  if (!account.smtp.host || !account.smtp.user) throw new Error("SMTP host/user required");
  if (!account.mail.defaultFrom) throw new Error("Default From is required");

  const caldavUrl = String(raw.caldav_url ?? "").trim();
  if (caldavUrl) {
    account.caldav = {
      url: caldavUrl,
      user: String(raw.caldav_user ?? account.imap.user).trim(),
      pass:
        String(raw.caldav_pass ?? "").trim() ||
        opts?.keepPass?.caldav?.pass ||
        account.imap.pass,
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

export async function updateAccountOAuth(
  id: string,
  oauth: AccountOAuth,
  extras?: Partial<Pick<Account, "label" | "imap" | "smtp" | "mail" | "provider" | "authType">>
): Promise<Account> {
  const data = await readFile();
  const idx = data.accounts.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error("Account not found");
  const prev = data.accounts[idx];
  const next: Account = {
    ...prev,
    ...extras,
    provider: extras?.provider ?? prev.provider ?? oauth.provider,
    authType: "oauth2",
    oauth,
    imap: {
      ...prev.imap,
      ...(extras?.imap ?? {}),
      user: extras?.imap?.user ?? oauth.email,
      pass: "",
    },
    smtp: {
      ...prev.smtp,
      ...(extras?.smtp ?? {}),
      user: extras?.smtp?.user ?? oauth.email,
      pass: "",
    },
    mail: {
      ...prev.mail,
      ...(extras?.mail ?? {}),
      defaultFrom: extras?.mail?.defaultFrom ?? (prev.mail.defaultFrom || oauth.email),
    },
  };
  data.accounts[idx] = next;
  await writeFile(data);
  return next;
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
