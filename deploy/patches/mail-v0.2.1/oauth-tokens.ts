/**
 * bwb-mail-oauth — refresh Microsoft/Google tokens for IMAP/SMTP XOAUTH2.
 * Copied into claude-mail-mcp by apply.py.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface AccountOAuth {
  provider: "microsoft" | "google";
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  email: string;
}

export interface OAuthAccountSlice {
  id: string;
  authType?: string;
  oauth?: AccountOAuth;
  imap: { user: string; pass: string };
  smtp: { user: string; pass: string };
}

function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

async function refreshTokens(oauth: AccountOAuth): Promise<AccountOAuth> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: oauth.refreshToken,
  });
  let url: string;
  if (oauth.provider === "microsoft") {
    if (!microsoftConfigured()) {
      throw new Error("MICROSOFT_CLIENT_ID/SECRET missing for token refresh");
    }
    body.set("client_id", process.env.MICROSOFT_CLIENT_ID!);
    body.set("client_secret", process.env.MICROSOFT_CLIENT_SECRET!);
    body.set(
      "scope",
      [
        "offline_access",
        "https://outlook.office.com/IMAP.AccessAsUser.All",
        "https://outlook.office.com/SMTP.Send",
      ].join(" ")
    );
    url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
  } else {
    if (!googleConfigured()) {
      throw new Error("GOOGLE_CLIENT_ID/SECRET missing for token refresh");
    }
    body.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    body.set("client_secret", process.env.GOOGLE_CLIENT_SECRET!);
    url = "https://oauth2.googleapis.com/token";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        "OAuth refresh failed — re-link the account in /admin"
    );
  }
  return {
    ...oauth,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || oauth.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

async function persistOAuth(filePath: string, accountId: string, oauth: AccountOAuth): Promise<void> {
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw) as { version: number; accounts: Array<Record<string, unknown>> };
  const idx = data.accounts.findIndex((a) => a.id === accountId);
  if (idx < 0) return;
  data.accounts[idx] = { ...data.accounts[idx], oauth, authType: "oauth2" };
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, filePath);
  await fs.chmod(filePath, 0o600).catch(() => undefined);
}

export async function ensureOAuthAccessToken<T extends OAuthAccountSlice>(
  account: T,
  accountsFile: string
): Promise<T> {
  if (account.authType !== "oauth2" || !account.oauth?.refreshToken) {
    return account;
  }
  if (account.oauth.expiresAt > Date.now() + 120_000) {
    return account;
  }
  const oauth = await refreshTokens(account.oauth);
  await persistOAuth(accountsFile, account.id, oauth);
  return { ...account, oauth };
}

export function accountsFilePath(): string {
  return (
    process.env.ACCOUNTS_FILE ??
    path.join(process.env.STATE_DIR ?? "/var/lib/mail-mcp", "accounts.json")
  );
}
