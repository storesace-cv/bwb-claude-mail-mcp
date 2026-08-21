import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { Account, AccountOAuth } from "./accounts.js";
import { applyProviderPreset } from "./mail-providers.js";

export type OAuthMailProvider = "microsoft" | "google";

interface PendingOAuth {
  provider: OAuthMailProvider;
  accountId: string;
  label?: string;
  createdAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
}

function statePath(state: string): string {
  return path.join(config.oauthStateDir, `mail-oauth-${state}.json`);
}

export function microsoftConfigured(): boolean {
  return Boolean(config.microsoftClientId && config.microsoftClientSecret);
}

export function googleConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

export function oauthRedirectUri(provider: OAuthMailProvider): string {
  return `${config.publicUrl}/admin/oauth/${provider}/callback`;
}

export async function createOAuthState(
  provider: OAuthMailProvider,
  accountId: string,
  label?: string
): Promise<string> {
  await fs.mkdir(config.oauthStateDir, { recursive: true });
  const state = randomBytes(24).toString("hex");
  const payload: PendingOAuth = {
    provider,
    accountId,
    label,
    createdAt: Date.now(),
  };
  await fs.writeFile(statePath(state), JSON.stringify(payload), { mode: 0o600 });
  return state;
}

export async function consumeOAuthState(state: string): Promise<PendingOAuth> {
  const file = statePath(state);
  try {
    const raw = await fs.readFile(file, "utf8");
    await fs.unlink(file).catch(() => undefined);
    const data = JSON.parse(raw) as PendingOAuth;
    if (Date.now() - data.createdAt > 15 * 60_000) {
      throw new Error("Sessão OAuth expirada — tenta outra vez");
    }
    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Estado OAuth inválido ou já usado");
    }
    throw err;
  }
}

export function buildAuthorizeUrl(provider: OAuthMailProvider, state: string): string {
  if (provider === "microsoft") {
    if (!microsoftConfigured()) {
      throw new Error("MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET não configurados");
    }
    const params = new URLSearchParams({
      client_id: config.microsoftClientId,
      response_type: "code",
      redirect_uri: oauthRedirectUri("microsoft"),
      response_mode: "query",
      scope: [
        "offline_access",
        "openid",
        "email",
        "profile",
        "https://outlook.office.com/IMAP.AccessAsUser.All",
        "https://outlook.office.com/SMTP.Send",
      ].join(" "),
      state,
    });
    return `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`;
  }

  if (!googleConfigured()) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET não configurados");
  }
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    response_type: "code",
    redirect_uri: oauthRedirectUri("google"),
    scope: ["https://mail.google.com/", "openid", "email"].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(
  provider: OAuthMailProvider,
  code: string
): Promise<TokenResponse> {
  if (provider === "microsoft") {
    const body = new URLSearchParams({
      client_id: config.microsoftClientId,
      client_secret: config.microsoftClientSecret,
      code,
      redirect_uri: oauthRedirectUri("microsoft"),
      grant_type: "authorization_code",
    });
    const res = await fetch(
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }
    );
    const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
    if (!res.ok) {
      throw new Error(json.error_description || json.error || `Token HTTP ${res.status}`);
    }
    return json;
  }

  const body = new URLSearchParams({
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    code,
    redirect_uri: oauthRedirectUri("google"),
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Token HTTP ${res.status}`);
  }
  return json;
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
    };
    return json.email || json.preferred_username || null;
  } catch {
    return null;
  }
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

export async function tokensFromAuthorizationCode(
  provider: OAuthMailProvider,
  code: string
): Promise<AccountOAuth> {
  const tokens = await exchangeCode(provider, code);
  if (!tokens.access_token) throw new Error("Resposta OAuth sem access_token");

  let email = emailFromIdToken(tokens.id_token);
  if (!email && provider === "google") {
    email = await fetchGoogleEmail(tokens.access_token);
  }
  if (!email) throw new Error("Não foi possível obter o email da conta OAuth");

  const refresh = tokens.refresh_token;
  if (!refresh) {
    throw new Error(
      "Sem refresh_token — revoga o acesso à app na conta e volta a autorizar com consentimento."
    );
  }

  return {
    provider,
    accessToken: tokens.access_token,
    refreshToken: refresh,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    email,
  };
}

export async function refreshAccountOAuth(account: Account): Promise<AccountOAuth> {
  if (!account.oauth?.refreshToken) {
    throw new Error("Conta sem refresh_token OAuth");
  }
  const provider = account.oauth.provider;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.oauth.refreshToken,
  });

  let url: string;
  if (provider === "microsoft") {
    if (!microsoftConfigured()) throw new Error("Microsoft OAuth não configurado");
    body.set("client_id", config.microsoftClientId);
    body.set("client_secret", config.microsoftClientSecret);
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
    if (!googleConfigured()) throw new Error("Google OAuth não configurado");
    body.set("client_id", config.googleClientId);
    body.set("client_secret", config.googleClientSecret);
    url = "https://oauth2.googleapis.com/token";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new Error(
      json.error_description ||
        json.error ||
        "Refresh OAuth falhou — volta a «Ligar» a conta na admin"
    );
  }
  if (!json.access_token) throw new Error("Refresh sem access_token");

  return {
    provider,
    email: account.oauth.email,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || account.oauth.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/** Ensure access token is valid (~2 min skew). Persists via caller. */
export async function ensureFreshAccessToken(account: Account): Promise<Account> {
  if (account.authType !== "oauth2" || !account.oauth) return account;
  if (account.oauth.expiresAt > Date.now() + 120_000) return account;
  const oauth = await refreshAccountOAuth(account);
  const { updateAccountOAuth } = await import("./accounts.js");
  return updateAccountOAuth(account.id, oauth);
}

export function oauthAccountSkeleton(
  id: string,
  provider: OAuthMailProvider,
  oauth: AccountOAuth,
  label?: string
): Account {
  const preset = applyProviderPreset(provider);
  return {
    id,
    label: label || oauth.email,
    provider,
    authType: "oauth2",
    oauth,
    imap: {
      host: preset.imap_host,
      port: Number(preset.imap_port),
      user: oauth.email,
      pass: "",
      tls: true,
    },
    smtp: {
      host: preset.smtp_host,
      port: Number(preset.smtp_port),
      user: oauth.email,
      pass: "",
      tls: true,
    },
    mail: {
      defaultFrom: oauth.email,
      draftsFolder: provider === "google" ? "[Gmail]/Drafts" : "Drafts",
      sentFolder: provider === "google" ? "[Gmail]/Sent Mail" : "Sent",
    },
  };
}
