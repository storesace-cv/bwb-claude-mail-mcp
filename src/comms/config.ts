import path from "node:path";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const commsConfig = {
  host: process.env.COMMS_HOST ?? "127.0.0.1",
  port: Number(process.env.COMMS_PORT ?? "3230"),
  publicUrl: required("COMMS_PUBLIC_URL", "https://comms.bwb.pt").replace(/\/$/, ""),
  stateDir: required("COMMS_STATE_DIR", "/var/lib/bwb-comms"),
  mailAccountsFile:
    process.env.MAIL_ACCOUNTS_FILE ?? "/var/lib/mail-mcp/accounts.json",
  waAccountsFile:
    process.env.WA_ACCOUNTS_FILE ?? "/var/lib/whatsapp-mcp/wa-accounts.json",
  waStateDir: process.env.WA_STATE_DIR ?? "/var/lib/whatsapp-mcp",
  sessionSecret: required("COMMS_SESSION_SECRET", "change-me-in-production"),
  cookieName: "bwb_comms_session",
  authToken: process.env.COMMS_AUTH_TOKEN ?? "",
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID ?? "",
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  mailSyncMs: Number(process.env.MAIL_SYNC_MS ?? String(10 * 60_000)),
  waSyncMs: Number(process.env.WA_SYNC_MS ?? String(5 * 60_000)),
  digestTo: process.env.DIGEST_TO ?? "",
  digestHour: Number(process.env.DIGEST_HOUR ?? "7"),
  helpdeskContextUrl: process.env.HELPDESK_CONTEXT_URL ?? "",
  helpdeskContextToken: process.env.HELPDESK_CONTEXT_TOKEN ?? "",
  agtGroupJid: process.env.AGT_GROUP_JID ?? "244928277927-1565965350@g.us",
  get agtKbJsonPath() {
    return process.env.AGT_KB_JSON_PATH ?? path.join(this.stateDir, "agt", "agt-knowledge-base.json");
  },
  get dbPath() {
    return process.env.COMMS_DB_PATH ?? path.join(this.stateDir, "comms.db");
  },
  get filesDir() {
    return process.env.COMMS_FILES_DIR ?? path.join(this.stateDir, "files");
  },
  get adminFile() {
    return process.env.COMMS_ADMIN_FILE ?? path.join(this.stateDir, "admin.json");
  },
  get rulesFile() {
    return process.env.COMMS_RULES_FILE ?? path.join(this.stateDir, "folder-rules.json");
  },
  s3: {
    endpoint: process.env.EURONODES_S3_ENDPOINT ?? "https://eu-west-1.euronodes.com",
    bucket: process.env.EURONODES_S3_BUCKET ?? "bwb-backups",
    accessKey: process.env.EURONODES_S3_ACCESS_KEY ?? "",
    secretKey: process.env.EURONODES_S3_SECRET_KEY ?? "",
  },
};
