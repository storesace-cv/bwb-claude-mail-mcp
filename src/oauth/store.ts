import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SignJWT, exportJWK, importPKCS8, importSPKI, jwtVerify, type KeyLike, type JWK } from "jose";
import { config } from "../config.js";

export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  created_at: string;
}

export interface AuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  expires_at: number;
  admin_email: string;
}

export interface RefreshRecord {
  hash: string;
  client_id: string;
  admin_email: string;
  expires_at: number;
}

let privateKey: KeyLike | null = null;
let publicKey: KeyLike | null = null;
let publicJwk: JWK | null = null;

async function ensureKeys(): Promise<void> {
  if (privateKey && publicKey && publicJwk) return;
  try {
    const privPem = await fs.readFile(config.jwtPrivateKeyPath, "utf8");
    const pubPem = await fs.readFile(config.jwtPublicKeyPath, "utf8");
    privateKey = await importPKCS8(privPem, "RS256");
    publicKey = await importSPKI(pubPem, "RS256");
  } catch {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey: priv, publicKey: pub } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    await fs.mkdir(path.dirname(config.jwtPrivateKeyPath), { recursive: true });
    await fs.writeFile(config.jwtPrivateKeyPath, priv, { mode: 0o600 });
    await fs.writeFile(config.jwtPublicKeyPath, pub, { mode: 0o644 });
    privateKey = await importPKCS8(priv, "RS256");
    publicKey = await importSPKI(pub, "RS256");
  }
  const jwk = await exportJWK(publicKey);
  publicJwk = { ...jwk, alg: "RS256", use: "sig", kid: config.jwtKid };
}

function statePath(name: string): string {
  return path.join(config.oauthStateDir, name);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function initOAuthStore(): Promise<void> {
  await fs.mkdir(config.oauthStateDir, { recursive: true });
  await ensureKeys();
}

export async function getJwks(): Promise<{ keys: JWK[] }> {
  await ensureKeys();
  return { keys: [publicJwk!] };
}

export function metadata() {
  const issuer = config.publicUrl;
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    jwks_uri: `${issuer}/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: ["mcp"],
  };
}

export async function registerClient(body: {
  redirect_uris?: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
}): Promise<OAuthClient & { client_id_issued_at: number }> {
  const redirect_uris = body.redirect_uris?.filter(Boolean) ?? [];
  if (!redirect_uris.length) throw new Error("redirect_uris required");
  const client: OAuthClient = {
    client_id: randomBytes(16).toString("hex"),
    client_secret: randomBytes(24).toString("hex"),
    redirect_uris,
    client_name: body.client_name,
    created_at: new Date().toISOString(),
  };
  const clients = await readJson<Record<string, OAuthClient>>(statePath("clients.json"), {});
  clients[client.client_id] = client;
  await writeJson(statePath("clients.json"), clients);
  return {
    ...client,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const clients = await readJson<Record<string, OAuthClient>>(statePath("clients.json"), {});
  return clients[clientId] ?? null;
}

export async function saveAuthCode(code: AuthCode): Promise<void> {
  const codes = await readJson<Record<string, AuthCode>>(statePath("codes.json"), {});
  // prune expired
  const now = Date.now();
  for (const [k, v] of Object.entries(codes)) {
    if (v.expires_at < now) delete codes[k];
  }
  codes[code.code] = code;
  await writeJson(statePath("codes.json"), codes);
}

export async function consumeAuthCode(code: string): Promise<AuthCode | null> {
  const codes = await readJson<Record<string, AuthCode>>(statePath("codes.json"), {});
  const found = codes[code];
  if (!found) return null;
  delete codes[code];
  await writeJson(statePath("codes.json"), codes);
  if (found.expires_at < Date.now()) return null;
  return found;
}

function sha256b64url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = sha256b64url(verifier);
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function issueTokens(opts: {
  client_id: string;
  admin_email: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}> {
  await ensureKeys();
  const access_token = await new SignJWT({
    sub: opts.admin_email,
    client_id: opts.client_id,
    scope: "mcp",
  })
    .setProtectedHeader({ alg: "RS256", kid: config.jwtKid })
    .setIssuer(config.publicUrl)
    .setAudience(config.publicUrl)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSec}s`)
    .sign(privateKey!);

  const refresh_token = randomBytes(32).toString("hex");
  const refresh: RefreshRecord = {
    hash: sha256b64url(refresh_token),
    client_id: opts.client_id,
    admin_email: opts.admin_email,
    expires_at: Date.now() + config.refreshTokenTtlSec * 1000,
  };
  const refreshes = await readJson<RefreshRecord[]>(statePath("refresh.json"), []);
  const pruned = refreshes.filter((r) => r.expires_at > Date.now());
  pruned.push(refresh);
  await writeJson(statePath("refresh.json"), pruned);

  return {
    access_token,
    refresh_token,
    token_type: "Bearer",
    expires_in: config.accessTokenTtlSec,
  };
}

export async function verifyAccessToken(token: string): Promise<{ sub: string } | null> {
  try {
    await ensureKeys();
    const { payload } = await jwtVerify(token, publicKey!, {
      issuer: config.publicUrl,
      audience: config.publicUrl,
    });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export async function rotateRefreshToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
} | null> {
  const hash = sha256b64url(refreshToken);
  const refreshes = await readJson<RefreshRecord[]>(statePath("refresh.json"), []);
  const idx = refreshes.findIndex((r) => r.hash === hash && r.expires_at > Date.now());
  if (idx < 0) return null;
  const rec = refreshes[idx];
  refreshes.splice(idx, 1);
  await writeJson(statePath("refresh.json"), refreshes);
  return issueTokens({ client_id: rec.client_id, admin_email: rec.admin_email });
}

export async function loadUpstreamBearer(): Promise<string> {
  if (config.authToken) return config.authToken.trim();
  try {
    return (await fs.readFile(config.authTokenFile, "utf8")).trim();
  } catch {
    throw new Error("AUTH_TOKEN / UPSTREAM_BEARER_FILE not configured");
  }
}
