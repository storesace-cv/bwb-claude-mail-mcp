import { promises as fs } from "node:fs";
import { config } from "../config.js";

export interface ProbeResult {
  ok: boolean;
  detail: string;
  statusCode?: number;
}

export interface WhatsappStatus {
  bridge: ProbeResult;
  mcp: ProbeResult;
  bridgeTokenPresent: boolean;
}

async function readBridgeToken(): Promise<string | null> {
  try {
    const t = (await fs.readFile(config.bridgeTokenFile, "utf8")).trim();
    return t || null;
  } catch {
    return null;
  }
}

async function probe(url: string, init?: RequestInit): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    const text = (await res.text()).slice(0, 200);
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

async function probeMcp(): Promise<ProbeResult> {
  const base = config.upstreamMcpUrl.replace(/\/$/, "");
  const health = await probe(`${base}/health`);
  if (health.ok) return health;

  const mcp = await probe(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  // Any non-5xx from /mcp means the process is listening
  if (mcp.statusCode && mcp.statusCode < 500) {
    return { ...mcp, ok: true, detail: `MCP responde (HTTP ${mcp.statusCode})` };
  }
  return health.detail !== `HTTP ${health.statusCode}` ? health : mcp;
}

export async function getWhatsappStatus(): Promise<WhatsappStatus> {
  const token = await readBridgeToken();
  const bridgeHeaders: Record<string, string> = {};
  if (token) bridgeHeaders.Authorization = `Bearer ${token}`;

  const [bridge, mcp] = await Promise.all([
    probe(`${config.bridgeUrl}/api/health`, { headers: bridgeHeaders }),
    probeMcp(),
  ]);

  return {
    bridge,
    mcp,
    bridgeTokenPresent: Boolean(token),
  };
}
