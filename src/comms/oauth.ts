import type { MailAccount } from "./accounts.js";
import { persistAccountOAuth } from "./accounts.js";
import { commsConfig } from "./config.js";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export async function ensureFreshAccessToken(account: MailAccount): Promise<MailAccount> {
  if (account.authType !== "oauth2" || !account.oauth) return account;
  if (account.oauth.expiresAt > Date.now() + 120_000) return account;
  if (!account.oauth.refreshToken) throw new Error("Conta sem refresh_token OAuth");

  const provider = account.oauth.provider;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.oauth.refreshToken,
  });
  let url: string;
  if (provider === "microsoft") {
    if (!commsConfig.microsoftClientId || !commsConfig.microsoftClientSecret) {
      throw new Error("Microsoft OAuth não configurado no comms");
    }
    body.set("client_id", commsConfig.microsoftClientId);
    body.set("client_secret", commsConfig.microsoftClientSecret);
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
    if (!commsConfig.googleClientId || !commsConfig.googleClientSecret) {
      throw new Error("Google OAuth não configurado no comms");
    }
    body.set("client_id", commsConfig.googleClientId);
    body.set("client_secret", commsConfig.googleClientSecret);
    url = "https://oauth2.googleapis.com/token";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Refresh OAuth falhou");
  }
  const oauth = {
    provider,
    email: account.oauth.email,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || account.oauth.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  try {
    await persistAccountOAuth(account.id, oauth);
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "oauth persist failed",
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
  return { ...account, oauth };
}

export function imapAuth(account: MailAccount): {
  user: string;
  pass?: string;
  accessToken?: string;
} {
  if (account.authType === "oauth2" && account.oauth?.accessToken) {
    return { user: account.imap.user, accessToken: account.oauth.accessToken };
  }
  return { user: account.imap.user, pass: account.imap.pass };
}

export function smtpAuth(account: MailAccount): {
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
