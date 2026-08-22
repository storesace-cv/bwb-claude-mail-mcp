import { promises as fs } from "node:fs";
import path from "node:path";
import { commsConfig } from "../config.js";
import { ingestWhatsappDb } from "./store.js";
import { jobError, jobLog, jobProgress } from "../jobs/progress.js";

export interface WaAccount {
  id: string;
  label: string;
  storeDir: string;
}

const DEFAULT_WA_LABELS: Record<string, string> = {
  a: "Pessoal",
  b: "Angola",
};

export async function listWaAccounts(): Promise<WaAccount[]> {
  try {
    const raw = await fs.readFile(commsConfig.waAccountsFile, "utf8");
    const parsed = JSON.parse(raw) as {
      accounts?: Array<{ id: string; storeDir: string; label?: string; name?: string }>;
    };
    if (Array.isArray(parsed.accounts) && parsed.accounts.length) {
      return parsed.accounts.map((a) => ({
        id: a.id,
        storeDir: a.storeDir,
        label: a.label || a.name || DEFAULT_WA_LABELS[a.id] || a.id,
      }));
    }
  } catch {
    // defaults
  }
  return [
    {
      id: "a",
      label: DEFAULT_WA_LABELS.a,
      storeDir: path.join(commsConfig.waStateDir, "accounts", "a", "store"),
    },
    {
      id: "b",
      label: DEFAULT_WA_LABELS.b,
      storeDir: path.join(commsConfig.waStateDir, "accounts", "b", "store"),
    },
  ];
}

export async function syncAllWhatsapp(): Promise<{ accounts: number; inserted: number }> {
  const accounts = await listWaAccounts();
  jobLog(`${accounts.length} contas WhatsApp.`);
  let inserted = 0;
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    jobProgress(Math.round(((i + 1) / Math.max(accounts.length, 1)) * 90));
    const dbPath = path.join(account.storeDir, "messages.db");
    try {
      await fs.access(dbPath);
    } catch {
      jobLog(`${account.label}: sem messages.db, a saltar.`);
      continue;
    }
    jobLog(`A ler ${account.label}…`);
    try {
      const r = ingestWhatsappDb(account.id, dbPath);
      inserted += r.inserted;
      jobLog(`${account.label}: ${r.inserted} novas.`);
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          msg: "wa sync",
          account: account.id,
          inserted: r.inserted,
        })
      );
    } catch (err) {
      jobError(`${account.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { accounts: accounts.length, inserted };
}
