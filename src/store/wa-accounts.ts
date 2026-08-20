import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface WhatsappAccount {
  id: string;
  label: string;
  bridgeUrl: string;
  mcpUrl: string;
  storeDir: string;
  /** Public path e.g. /a/mcp */
  publicMcpPath: string;
  bridgeUnit: string;
  mcpUnit: string;
}

const DEFAULT_ACCOUNTS: WhatsappAccount[] = [
  {
    id: "a",
    label: "Pessoal",
    bridgeUrl: "http://127.0.0.1:18080",
    mcpUrl: "http://127.0.0.1:18000",
    storeDir: "/var/lib/whatsapp-mcp/accounts/a/store",
    publicMcpPath: "/a/mcp",
    bridgeUnit: "whatsapp-bridge-a",
    mcpUnit: "whatsapp-mcp-a",
  },
  {
    id: "b",
    label: "Negócio",
    bridgeUrl: "http://127.0.0.1:18082",
    mcpUrl: "http://127.0.0.1:18002",
    storeDir: "/var/lib/whatsapp-mcp/accounts/b/store",
    publicMcpPath: "/b/mcp",
    bridgeUnit: "whatsapp-bridge-b",
    mcpUnit: "whatsapp-mcp-b",
  },
];

function accountsFile(): string {
  return process.env.WA_ACCOUNTS_FILE ?? path.join(config.stateDir, "wa-accounts.json");
}

let cached: WhatsappAccount[] | null = null;

export async function listWhatsappAccounts(): Promise<WhatsappAccount[]> {
  if (cached) return cached;
  try {
    const raw = JSON.parse(await fs.readFile(accountsFile(), "utf8")) as {
      accounts?: WhatsappAccount[];
    };
    if (Array.isArray(raw.accounts) && raw.accounts.length > 0) {
      cached = raw.accounts.map((a) => ({
        ...a,
        bridgeUrl: a.bridgeUrl.replace(/\/$/, ""),
        mcpUrl: a.mcpUrl.replace(/\/$/, ""),
        publicMcpPath: a.publicMcpPath.startsWith("/")
          ? a.publicMcpPath
          : `/${a.publicMcpPath}`,
      }));
      return cached;
    }
  } catch {
    // fall through to defaults
  }
  cached = DEFAULT_ACCOUNTS.map((a) => ({
    ...a,
    storeDir: path.join(config.stateDir, "accounts", a.id, "store"),
  }));
  return cached;
}

export async function getWhatsappAccount(id: string): Promise<WhatsappAccount | null> {
  const all = await listWhatsappAccounts();
  return all.find((a) => a.id === id) ?? null;
}

/** Resolve account from request path: /a/mcp, /b/mcp, or legacy /mcp → a */
export async function accountFromMcpPath(reqPath: string): Promise<WhatsappAccount | null> {
  const all = await listWhatsappAccounts();
  const normalized = reqPath.replace(/\/+$/, "") || "/";
  if (normalized === "/mcp" || normalized.startsWith("/mcp/")) {
    return all.find((a) => a.id === "a") ?? all[0] ?? null;
  }
  for (const a of all) {
    const base = a.publicMcpPath.replace(/\/+$/, "");
    if (normalized === base || normalized.startsWith(`${base}/`)) {
      return a;
    }
  }
  return null;
}

export function publicMcpUrl(account: WhatsappAccount): string {
  return `${config.publicUrl}${account.publicMcpPath}`;
}

export async function allPublicMcpAudiences(): Promise<string[]> {
  const all = await listWhatsappAccounts();
  const urls = all.map((a) => publicMcpUrl(a));
  urls.push(config.publicUrl);
  urls.push(`${config.publicUrl}/mcp`);
  return [...new Set(urls)];
}

export function bridgeTokenPath(account: WhatsappAccount): string {
  return path.join(account.storeDir, ".bridge-token");
}

export function qrCodePath(account: WhatsappAccount): string {
  return path.join(account.storeDir, "qr.code");
}
