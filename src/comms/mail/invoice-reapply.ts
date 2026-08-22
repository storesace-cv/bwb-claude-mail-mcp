import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getDb } from "../db.js";
import { invoiceIssuers, invoiceRecipients, invoiceStage } from "../settings.js";
import { documentAccepted } from "./invoice-whitelist.js";
import { deleteAttachment, isS3ObjectKey } from "../storage.js";

export async function reapplyInvoiceWhitelist(): Promise<{ kept: number; removed: number }> {
  if (invoiceStage() !== "active") {
    throw new Error(
      "Re-aplicar só depois de haver destinatários na lista branca. Revê também os emissores. Documentos já guardados que não casem no PDF serão apagados."
    );
  }
  const issuers = invoiceIssuers();
  const recipients = invoiceRecipients();
  const rows = getDb()
    .prepare("SELECT id, path, extracted_text FROM invoices")
    .all() as Array<{ id: number; path: string; extracted_text: string }>;
  const del = getDb().prepare("DELETE FROM invoices WHERE id = ?");
  let kept = 0;
  let removed = 0;
  for (const row of rows) {
    if (documentAccepted(row.extracted_text, issuers, recipients)) {
      kept += 1;
      continue;
    }
    if (isS3ObjectKey(row.path)) await deleteAttachment(row.path);
    else if (existsSync(row.path)) await unlink(row.path).catch(() => undefined);
    del.run(row.id);
    removed += 1;
  }
  return { kept, removed };
}
