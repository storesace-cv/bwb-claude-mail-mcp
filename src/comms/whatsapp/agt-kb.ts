import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { commsConfig } from "../config.js";
import { getDb, getCursor, setCursor } from "../db.js";
import { sendCommsMail } from "../mail/send.js";
import { getSchedule, listWaWatches } from "../rules/store.js";
import { lisbonParts, shouldFireDaily } from "../time/lisbon.js";
import { matchesKeywords } from "./keywords.js";
import { upsertAllow } from "./store.js";
import { listWaAccounts } from "./sync.js";

const CURSOR = "schedule:agt-kb";
const GROUP_NAME = "AGT - IVA ANGOLA";

interface AgtJson {
  metadata: Record<string, unknown>;
  qa_tecnicos: Array<Record<string, unknown>>;
  documentos_legais_normativos?: Array<Record<string, unknown>>;
}

export async function runAgtKbIfDue(): Promise<{ ran: boolean; detail: string }> {
  const schedule = getSchedule("agt-kb");
  if (!schedule?.enabled) return { ran: false, detail: "agendamento desligado" };
  if (
    !shouldFireDaily({
      lastDateKey: getCursor(CURSOR),
      hour: schedule.hour,
      weekdaysOnly: schedule.weekdaysOnly,
    })
  ) {
    return { ran: false, detail: "não devido" };
  }
  const detail = await runAgtKb();
  setCursor(CURSOR, lisbonParts().dateKey);
  return { ran: true, detail: detail.slice(0, 200) };
}

export async function runAgtKb(): Promise<string> {
  const accounts = await listWaAccounts();
  const watches = listWaWatches().filter((w) => w.enabled && w.kbEnabled);
  const lines: string[] = [`KB WhatsApp — ${lisbonParts().dateKey}`, ""];
  let added = 0;
  let mediaCopied = 0;

  if (!watches.length) {
    const text = "Nenhuma vigia WhatsApp activa.";
    await sendCommsMail(`[BWB Comms] KB WhatsApp ${lisbonParts().dateKey}`, text);
    return text;
  }

  for (const watch of watches) {
    const account = accounts.find((a) => a.id === watch.accountId);
    if (!account) {
      lines.push(`[${watch.accountId}] conta em falta`);
      continue;
    }
    const messagesDb = path.join(account.storeDir, "messages.db");
    let bridge: Database.Database;
    try {
      bridge = new Database(messagesDb, { readonly: true, fileMustExist: true });
    } catch {
      lines.push(`[${watch.label}] messages.db inacessível`);
      continue;
    }
    try {
      const chat = bridge
        .prepare(
          `SELECT jid, name FROM chats WHERE jid = ? OR lower(name) = lower(?) LIMIT 1`
        )
        .get(watch.chatJid, watch.label) as { jid: string; name: string } | undefined;
      if (!chat) {
        lines.push(`[${account.id}] ${watch.label} não encontrado`);
        continue;
      }
      upsertAllow(account.id, chat.jid, chat.name || watch.label);
      const cursorKey = `agt:last-ts:${account.id}:${chat.jid}`;
      const lastTsRaw = getCursor(cursorKey);
      if (lastTsRaw === null) {
        const maxRow = bridge
          .prepare(`SELECT MAX(timestamp) AS m FROM messages WHERE chat_jid = ?`)
          .get(chat.jid) as { m: number | null };
        setCursor(cursorKey, String(maxRow.m ?? 0));
        lines.push(
          `[${account.id}] ${chat.name}: cursor inicializado (sem reimportar histórico)`
        );
        continue;
      }
      const lastTs = Number(lastTsRaw);
      const rows = bridge
        .prepare(
          `SELECT id, sender, content, timestamp, media_type, filename, url
           FROM messages WHERE chat_jid = ? AND timestamp > ? ORDER BY timestamp ASC`
        )
        .all(chat.jid, lastTs) as Array<{
        id: string;
        sender: string;
        content: string;
        timestamp: number;
        media_type: string | null;
        filename: string | null;
        url: string | null;
      }>;

      let maxTs = lastTs;
      const kb = await loadAgtJson();
      for (const row of rows) {
        const ts = Number(row.timestamp);
        const tsMs = ts < 1e12 ? ts * 1000 : ts;
        if (ts > maxTs) maxTs = ts;
        const text = String(row.content ?? "");
        const hasMedia = Boolean(row.media_type && row.media_type !== "text");
        if (!matchesKeywords(text, watch.keywords) && !hasMedia) continue;

        if (hasMedia) {
          const copied = await copyGroupMedia(account.storeDir, chat.jid, row.filename);
          mediaCopied += copied;
        }
        if (!matchesKeywords(text, watch.keywords) && hasMedia) {
          kb.documentos_legais_normativos = kb.documentos_legais_normativos ?? [];
          kb.documentos_legais_normativos.push({
            id: nextDocId(kb),
            titulo: row.filename || `media ${row.id}`,
            tipo: "Anexo WhatsApp (download local)",
            detalhes: [`${new Date(tsMs).toISOString()} — ${row.sender} — ${row.media_type}`],
            relevancia_modulo_fiscal: "Anexo capturado automaticamente; rever conteúdo.",
          });
          added += 1;
          continue;
        }

        const id = nextQaId(kb);
        kb.qa_tecnicos.push({
          id,
          categoria: "A classificar (ingest automático)",
          pergunta: text.slice(0, 2000) || `(media ${row.filename ?? row.id})`,
          resposta: "EM ABERTO",
          data: new Date(tsMs).toISOString().slice(0, 10),
          contexto_adicional: `sender ${row.sender}; msg ${row.id}`,
        });
        getDb()
          .prepare(
            `INSERT INTO kb_items (title, problem, solution, tags, source_type, source_ref, status, created_at)
             VALUES (?,?,?,?, 'wa', ?, 'draft', ?)`
          )
          .run(
            `AGT ${id}`,
            text.slice(0, 4000),
            "EM ABERTO",
            "agt,iva,saft",
            `${account.id}:${chat.jid}:${row.id}`,
            Date.now()
          );
        added += 1;
      }
      kb.metadata.periodo_coberto = String(kb.metadata.periodo_coberto ?? "").replace(
        /a \d{4}-\d{2}-\d{2}$/,
        `a ${lisbonParts().dateKey}`
      );
      if (!String(kb.metadata.periodo_coberto).includes(lisbonParts().dateKey)) {
        kb.metadata.periodo_coberto = `${kb.metadata.periodo_coberto || lisbonParts().dateKey} a ${lisbonParts().dateKey}`;
      }
      kb.metadata.data_geracao = lisbonParts().dateKey;
      kb.metadata.gerado_por = "BWB Comms (ingest automático, respostas EM ABERTO até revisão)";
      await saveAgtJson(kb);
      setCursor(`agt:last-ts:${account.id}:${chat.jid}`, String(maxTs));
      lines.push(
        `[${account.id}] ${chat.name}: ${rows.length} msgs novas, ${added} entradas relevantes, ${mediaCopied} anexos copiados`
      );
    } finally {
      bridge.close();
    }
  }

  if (added === 0) lines.push("Nada de novo relevante nas palavras-chave.");
  const text = lines.join("\n");
  await sendCommsMail(`[BWB Comms] AGT KB ${lisbonParts().dateKey}`, text);
  return text;
}

function nextQaId(kb: AgtJson): string {
  const nums = kb.qa_tecnicos
    .map((q) => Number(String(q.id ?? "").replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `qa-${String(n).padStart(3, "0")}`;
}

function nextDocId(kb: AgtJson): string {
  const docs = kb.documentos_legais_normativos ?? [];
  const nums = docs
    .map((q) => Number(String(q.id ?? "").replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `doc-${String(n).padStart(3, "0")}`;
}

async function loadAgtJson(): Promise<AgtJson> {
  try {
    const raw = await readFile(commsConfig.agtKbJsonPath, "utf8");
    return JSON.parse(raw) as AgtJson;
  } catch {
    return {
      metadata: {
        titulo: "Base de Conhecimento — Grupo WhatsApp 'AGT - IVA ANGOLA'",
        periodo_coberto: lisbonParts().dateKey,
        fonte: GROUP_NAME,
      },
      qa_tecnicos: [],
      documentos_legais_normativos: [],
    };
  }
}

async function saveAgtJson(kb: AgtJson): Promise<void> {
  await mkdir(path.dirname(commsConfig.agtKbJsonPath), { recursive: true, mode: 0o700 });
  const tmp = `${commsConfig.agtKbJsonPath}.tmp`;
  await writeFile(tmp, JSON.stringify(kb, null, 2) + "\n", { mode: 0o600 });
  const { rename } = await import("node:fs/promises");
  await rename(tmp, commsConfig.agtKbJsonPath);
}

async function copyGroupMedia(storeDir: string, jid: string, filename: string | null): Promise<number> {
  const srcDir = path.join(storeDir, jid);
  const destDir = path.join(commsConfig.filesDir, "agt", "anexos");
  try {
    await mkdir(destDir, { recursive: true, mode: 0o700 });
    const names = filename ? [filename] : await readdir(srcDir);
    let n = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      try {
        await copyFile(path.join(srcDir, name), path.join(destDir, name));
        n += 1;
      } catch {
        // missing
      }
    }
    return filename ? n : 0;
  } catch {
    return 0;
  }
}
