import path from "node:path";
import Database from "better-sqlite3";
import { listWaAccounts, type WaAccount } from "./sync.js";

export interface WaChatOption {
  jid: string;
  name: string;
}

export async function listWaChatsByAccount(): Promise<Map<string, WaChatOption[]>> {
  const accounts = await listWaAccounts();
  const map = new Map<string, WaChatOption[]>();
  for (const account of accounts) {
    map.set(account.id, listWaChatsForAccount(account));
  }
  return map;
}

export async function listWaChats(accountId: string): Promise<WaChatOption[]> {
  const accounts = await listWaAccounts();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return [];
  return listWaChatsForAccount(account);
}

export function listWaChatsForAccount(account: WaAccount): WaChatOption[] {
  const dbPath = path.join(account.storeDir, "messages.db");
  let bridge: Database.Database;
  try {
    bridge = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }
  try {
    try {
      return queryChats(
        bridge,
        `SELECT jid, COALESCE(NULLIF(name, ''), jid) AS name
         FROM chats ORDER BY last_message_time DESC, name ASC`
      );
    } catch {
      return queryChats(
        bridge,
        `SELECT jid, COALESCE(NULLIF(name, ''), jid) AS name FROM chats ORDER BY name ASC`
      );
    }
  } catch {
    return [];
  } finally {
    bridge.close();
  }
}

function queryChats(bridge: Database.Database, sql: string): WaChatOption[] {
  const rows = bridge.prepare(sql).all() as Array<{ jid: string; name: string }>;
  return rows.map((r) => ({ jid: r.jid, name: r.name || r.jid }));
}
