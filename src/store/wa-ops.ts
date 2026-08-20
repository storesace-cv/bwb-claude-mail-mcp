import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getWhatsappAccount,
  listWhatsappAccounts,
  type WhatsappAccount,
} from "./wa-accounts.js";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

function accountsFile(): string {
  return process.env.WA_ACCOUNTS_FILE ?? path.join(config.stateDir, "wa-accounts.json");
}

function logFileFor(account: WhatsappAccount): string {
  return path.join("/var/log/whatsapp-mcp", `bridge-${account.id}.log`);
}

export async function updateWhatsappAccountLabel(
  id: string,
  label: string
): Promise<WhatsappAccount> {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new Error("Nome inválido (1–64 caracteres)");
  }
  const all = await listWhatsappAccounts();
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error("Conta não encontrada");
  all[idx] = { ...all[idx], label: trimmed };
  const file = accountsFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ accounts: all }, null, 2) + "\n", { mode: 0o640 });
  await fs.rename(tmp, file);
  const { invalidateWhatsappAccountsCache } = await import("./wa-accounts.js");
  invalidateWhatsappAccountsCache();
  return all[idx];
}

export async function repairWhatsappAccount(id: string): Promise<{ message: string }> {
  const account = await getWhatsappAccount(id);
  if (!account) throw new Error("Conta não encontrada");

  const db = path.join(account.storeDir, "whatsapp.db");
  const qr = path.join(account.storeDir, "qr.code");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await fs.access(db);
    await fs.rename(db, `${db}.bak-${stamp}`);
  } catch {
    // no session yet
  }
  try {
    await fs.unlink(qr);
  } catch {
    // ignore
  }

  await restartBridge(account);
  return {
    message: `Sessão reiniciada para «${account.label}». Escaneia o QR quando aparecer.`,
  };
}

export async function restartBridge(account: WhatsappAccount): Promise<void> {
  try {
    await execFileAsync("sudo", ["-n", "systemctl", "restart", account.bridgeUnit], {
      timeout: 30_000,
    });
  } catch (err) {
    throw new Error(
      `Não foi possível reiniciar o serviço: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function readWhatsappAccountLogs(
  id: string,
  lines = 200
): Promise<{ source: string; text: string }> {
  const account = await getWhatsappAccount(id);
  if (!account) throw new Error("Conta não encontrada");
  const n = Math.min(Math.max(lines, 20), 500);
  const logFile = logFileFor(account);

  try {
    const raw = await fs.readFile(logFile, "utf8");
    const parts = raw.split("\n");
    const slice = parts.slice(-n).join("\n");
    if (slice.trim()) return { source: logFile, text: slice };
  } catch {
    // fall through to journalctl
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "sudo",
      ["-n", "journalctl", "-u", account.bridgeUnit, "-n", String(n), "--no-pager", "-o", "short-iso"],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }
    );
    const text = (stdout || stderr || "").trim() || "(sem entradas de log)";
    return { source: `journal:${account.bridgeUnit}`, text };
  } catch (err) {
    throw new Error(
      `Não foi possível ler os logs: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
