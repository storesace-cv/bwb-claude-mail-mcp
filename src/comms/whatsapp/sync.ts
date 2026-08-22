import { promises as fs } from "node:fs";
import path from "node:path";
import { commsConfig } from "../config.js";
import { ingestWhatsappDb } from "./store.js";

interface WaAccount {
  id: string;
  storeDir: string;
}

export async function listWaAccounts(): Promise<WaAccount[]> {
  try {
    const raw = await fs.readFile(commsConfig.waAccountsFile, "utf8");
    const parsed = JSON.parse(raw) as { accounts?: WaAccount[] };
    if (Array.isArray(parsed.accounts) && parsed.accounts.length) {
      return parsed.accounts.map((a) => ({
        id: a.id,
        storeDir: a.storeDir,
      }));
    }
  } catch {
    // defaults
  }
  return [
    {
      id: "a",
      storeDir: path.join(commsConfig.waStateDir, "accounts", "a", "store"),
    },
    {
      id: "b",
      storeDir: path.join(commsConfig.waStateDir, "accounts", "b", "store"),
    },
  ];
}

export async function syncAllWhatsapp(): Promise<{ accounts: number; inserted: number }> {
  const accounts = await listWaAccounts();
  let inserted = 0;
  for (const account of accounts) {
    const dbPath = path.join(account.storeDir, "messages.db");
    try {
      await fs.access(dbPath);
    } catch {
      continue;
    }
    const r = ingestWhatsappDb(account.id, dbPath);
    inserted += r.inserted;
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "wa sync",
        account: account.id,
        inserted: r.inserted,
      })
    );
  }
  return { accounts: accounts.length, inserted };
}
