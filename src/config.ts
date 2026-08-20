import path from "node:path";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? "3221"),
  publicUrl: required("PUBLIC_URL", "https://mcp-mail.bwb.pt").replace(/\/$/, ""),
  upstreamMcpUrl: required("UPSTREAM_MCP_URL", "http://127.0.0.1:3220"),
  stateDir: required("STATE_DIR", "/var/lib/mail-mcp"),
  get accountsFile() {
    return process.env.ACCOUNTS_FILE ?? path.join(this.stateDir, "accounts.json");
  },
  get adminFile() {
    return process.env.ADMIN_FILE ?? path.join(this.stateDir, "admin.json");
  },
  get oauthStateDir() {
    return process.env.OAUTH_STATE_DIR ?? path.join(this.stateDir, "oauth-state");
  },
  get jwtPrivateKeyPath() {
    return process.env.JWT_PRIVATE_KEY_PATH ?? path.join(this.stateDir, "jwt-private.pem");
  },
  get jwtPublicKeyPath() {
    return process.env.JWT_PUBLIC_KEY_PATH ?? path.join(this.stateDir, "jwt-public.pem");
  },
  get authTokenFile() {
    return process.env.UPSTREAM_BEARER_FILE ?? path.join(this.stateDir, "token");
  },
  authToken: process.env.AUTH_TOKEN ?? "",
  sessionSecret: required("SESSION_SECRET", "change-me-in-production"),
  cookieName: "mcp_mail_admin_session",
  accessTokenTtlSec: 3600,
  refreshTokenTtlSec: 30 * 24 * 3600,
  logLevel: process.env.LOG_LEVEL ?? "info",
};
