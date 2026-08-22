import { promises as fs } from "node:fs";
import { commsConfig } from "./config.js";

export interface MailAccount {
  id: string;
  label: string;
  default?: boolean;
  provider?: string;
  authType?: "password" | "oauth2";
  imap: { host: string; port: number; user: string; pass: string; tls: boolean };
  smtp: { host: string; port: number; user: string; pass: string; tls: boolean };
  mail: {
    defaultFrom: string;
    defaultFromName?: string;
    draftsFolder: string;
    sentFolder: string | null;
  };
  oauth?: {
    provider: "microsoft" | "google";
    refreshToken: string;
    accessToken: string;
    expiresAt: number;
    email: string;
  };
}

interface AccountsFile {
  version: 1;
  accounts: MailAccount[];
}

export async function listMailAccounts(): Promise<MailAccount[]> {
  try {
    const raw = await fs.readFile(commsConfig.mailAccountsFile, "utf8");
    const parsed = JSON.parse(raw) as AccountsFile;
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function persistAccountOAuth(
  id: string,
  oauth: NonNullable<MailAccount["oauth"]>
): Promise<void> {
  const raw = await fs.readFile(commsConfig.mailAccountsFile, "utf8");
  const parsed = JSON.parse(raw) as AccountsFile;
  const idx = parsed.accounts.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error(`Account ${id} not found`);
  parsed.accounts[idx] = { ...parsed.accounts[idx], oauth, authType: "oauth2" };
  const tmp = `${commsConfig.mailAccountsFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(parsed, null, 2) + "\n", { mode: 0o660 });
  await fs.rename(tmp, commsConfig.mailAccountsFile);
}

export function myAddresses(account: MailAccount): string[] {
  const addrs = [account.mail.defaultFrom, account.imap.user, account.oauth?.email ?? ""];
  return [...new Set(addrs.map((a) => a.trim().toLowerCase()).filter(Boolean))];
}
