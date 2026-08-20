import path from "node:path";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const appModeRaw = (process.env.APP_MODE ?? "mail").toLowerCase();
const appMode = appModeRaw === "whatsapp" ? "whatsapp" : "mail";
const isWhatsapp = appMode === "whatsapp";

const defaultPublicUrl = isWhatsapp ? "https://mcp-whatsapp.bwb.pt" : "https://mcp-mail.bwb.pt";
const defaultUpstream = isWhatsapp ? "http://127.0.0.1:18000" : "http://127.0.0.1:3220";
const defaultStateDir = isWhatsapp ? "/var/lib/whatsapp-mcp" : "/var/lib/mail-mcp";
const defaultPort = isWhatsapp ? "18001" : "3221";

export const config = {
  appMode: appMode as "mail" | "whatsapp",
  isWhatsapp,
  productName: isWhatsapp ? "MCP WhatsApp" : "MCP Mail",
  serviceName: isWhatsapp ? "mcp-oauth-shim-whatsapp" : "mcp-oauth-shim-mail",
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? defaultPort),
  publicUrl: required("PUBLIC_URL", defaultPublicUrl).replace(/\/$/, ""),
  upstreamMcpUrl: required("UPSTREAM_MCP_URL", defaultUpstream),
  stateDir: required("STATE_DIR", defaultStateDir),
  /** Mail injects AUTH_TOKEN into upstream; WhatsApp MCP Python has no native auth. */
  injectUpstreamBearer:
    (process.env.INJECT_UPSTREAM_BEARER ?? (isWhatsapp ? "false" : "true")).toLowerCase() ===
    "true",
  bridgeUrl: (process.env.BRIDGE_URL ?? "http://127.0.0.1:18080").replace(/\/$/, ""),
  get bridgeTokenFile() {
    return (
      process.env.BRIDGE_TOKEN_FILE ?? path.join(this.stateDir, "store", ".bridge-token")
    );
  },
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
  cookieName: isWhatsapp ? "mcp_wa_admin_session" : "mcp_mail_admin_session",
  jwtKid: isWhatsapp ? "whatsapp-mcp-1" : "mail-mcp-1",
  accessTokenTtlSec: 3600,
  refreshTokenTtlSec: 30 * 24 * 3600,
  logLevel: process.env.LOG_LEVEL ?? "info",
};
