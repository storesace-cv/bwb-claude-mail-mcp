import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getDb } from "../db.js";
import { jobLog, jobProgress, jobStep } from "../jobs/progress.js";
import type { JobResult } from "../jobs/run.js";
import { invoiceIssuers, invoiceRecipients, mailCutoffMs, mailMaxAgeDays } from "../settings.js";
import { shouldKeepStoredInvoice, whitelistHasEntries } from "./invoice-whitelist.js";
import { deleteAttachment, isS3ObjectKey } from "../storage.js";

export async function reapplyInvoiceWhitelist(): Promise<{
  kept: number;
  removed: number;
  removedOld: number;
  removedLists: number;
}> {
  const issuers = invoiceIssuers();
  const recipients = invoiceRecipients();
  const cutoffMs = mailCutoffMs();
  const days = mailMaxAgeDays();
  const listsOn = whitelistHasEntries(issuers, recipients);
  jobStep("filter", "Antiguidade e listas brancas");
  jobLog(`Prazo: ${days} dias (desde ${new Date(cutoffMs).toISOString().slice(0, 10)}).`);
  jobLog(
    listsOn
      ? "Listas brancas ligadas: o texto do PDF tem de casar com emissores ou destinatários."
      : "Listas brancas vazias: só se aplica o prazo de antiguidade."
  );
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.path, i.extracted_text, i.created_at, m.date_ms AS msg_date_ms
       FROM invoices i
       LEFT JOIN mail_messages m ON m.id = i.mail_message_pk`
    )
    .all() as Array<{
    id: number;
    path: string;
    extracted_text: string;
    created_at: number;
    msg_date_ms: number | null;
  }>;
  jobLog(`${rows.length} documentos na base.`);
  const del = getDb().prepare("DELETE FROM invoices WHERE id = ?");
  let kept = 0;
  let removed = 0;
  let removedOld = 0;
  let removedLists = 0;
  let i = 0;
  for (const row of rows) {
    i += 1;
    const dateMs = Number(row.msg_date_ms ?? row.created_at);
    const tooOld = !Number.isFinite(dateMs) || dateMs < cutoffMs;
    const keep = shouldKeepStoredInvoice({
      dateMs,
      cutoffMs,
      extractedText: row.extracted_text,
      issuers,
      recipients,
    });
    if (keep) {
      kept += 1;
    } else {
      jobStep("purge", "Apagar documentos que não passam");
      if (isS3ObjectKey(row.path)) await deleteAttachment(row.path);
      else if (existsSync(row.path)) await unlink(row.path).catch(() => undefined);
      del.run(row.id);
      removed += 1;
      if (tooOld) removedOld += 1;
      else removedLists += 1;
    }
    if (i === 1 || i % 50 === 0 || i === rows.length) {
      jobProgress(Math.round((i / Math.max(rows.length, 1)) * 99));
      jobLog(`Avaliados ${i}/${rows.length} (mantidos ${kept}, removidos ${removed}).`);
    }
  }
  jobProgress(100);
  jobLog(`Fim: ${kept} mantidos, ${removed} removidos (${removedOld} fora do prazo, ${removedLists} listas).`);
  return { kept, removed, removedOld, removedLists };
}

export async function runReapplyInvoices(): Promise<JobResult> {
  try {
    const r = await reapplyInvoiceWhitelist();
    return {
      name: "invoices-reapply",
      ok: true,
      detail: `${r.kept} documentos mantidos. ${r.removed} removidos (${r.removedOld} fora do prazo de ${mailMaxAgeDays()} dias, ${r.removedLists} por listas brancas).`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { name: "invoices-reapply", ok: false, detail };
  }
}
