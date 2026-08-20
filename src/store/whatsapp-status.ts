import { promises as fs } from "node:fs";
import QRCode from "qrcode";
import {
  bridgeTokenPath,
  listWhatsappAccounts,
  publicMcpUrl,
  qrCodePath,
  type WhatsappAccount,
} from "./wa-accounts.js";

export interface ProbeResult {
  ok: boolean;
  detail: string;
  statusCode?: number;
}

export type PairingState = "paired" | "awaiting_qr" | "starting" | "unknown";

export interface WhatsappAccountStatus {
  account: WhatsappAccount;
  publicMcpUrl: string;
  bridge: ProbeResult;
  mcp: ProbeResult;
  bridgeTokenPresent: boolean;
  pairingState: PairingState;
  qrCode: string | null;
  qrDataUrl: string | null;
  connected: boolean;
}

async function readBridgeToken(account: WhatsappAccount): Promise<string | null> {
  try {
    const t = (await fs.readFile(bridgeTokenPath(account), "utf8")).trim();
    return t || null;
  } catch {
    return null;
  }
}

async function readQrCode(account: WhatsappAccount): Promise<string | null> {
  try {
    const code = (await fs.readFile(qrCodePath(account), "utf8")).trim();
    return code || null;
  } catch {
    return null;
  }
}

async function probe(url: string, init?: RequestInit): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    const text = (await res.text()).slice(0, 400);
    return {
      ok: res.ok,
      statusCode: res.status,
      detail: text || `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeMcp(mcpBase: string): Promise<ProbeResult> {
  const base = mcpBase.replace(/\/$/, "");
  const health = await probe(`${base}/health`);
  if (health.ok) return health;

  const mcp = await probe(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  if (mcp.statusCode && mcp.statusCode < 500) {
    return { ...mcp, ok: true, detail: `MCP responde (HTTP ${mcp.statusCode})` };
  }
  return health.detail !== `HTTP ${health.statusCode}` ? health : mcp;
}

function parseConnected(bridge: ProbeResult): boolean {
  if (!bridge.ok) return false;
  try {
    const j = JSON.parse(bridge.detail) as { connected?: boolean };
    return Boolean(j.connected);
  } catch {
    return bridge.ok;
  }
}

export async function getWhatsappAccountStatus(
  account: WhatsappAccount
): Promise<WhatsappAccountStatus> {
  const token = await readBridgeToken(account);
  const bridgeHeaders: Record<string, string> = {};
  if (token) bridgeHeaders.Authorization = `Bearer ${token}`;

  const [bridge, mcp, qrCode] = await Promise.all([
    probe(`${account.bridgeUrl}/api/health`, { headers: bridgeHeaders }),
    probeMcp(account.mcpUrl),
    readQrCode(account),
  ]);

  const connected = parseConnected(bridge);
  let pairingState: PairingState;
  if (connected) pairingState = "paired";
  else if (qrCode) pairingState = "awaiting_qr";
  else if (!bridge.ok) pairingState = "starting";
  else pairingState = "unknown";

  let qrDataUrl: string | null = null;
  if (qrCode && pairingState === "awaiting_qr") {
    try {
      qrDataUrl = await QRCode.toDataURL(qrCode, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 280,
        color: { dark: "#1d1d1f", light: "#ffffff" },
      });
    } catch {
      qrDataUrl = null;
    }
  }

  return {
    account,
    publicMcpUrl: publicMcpUrl(account),
    bridge,
    mcp,
    bridgeTokenPresent: Boolean(token),
    pairingState,
    qrCode,
    qrDataUrl,
    connected,
  };
}

export async function getAllWhatsappStatuses(): Promise<WhatsappAccountStatus[]> {
  const accounts = await listWhatsappAccounts();
  return Promise.all(accounts.map((a) => getWhatsappAccountStatus(a)));
}

/** @deprecated use getAllWhatsappStatuses — kept for single-account callers */
export async function getWhatsappStatus(): Promise<WhatsappAccountStatus> {
  const all = await getAllWhatsappStatuses();
  return all[0]!;
}
