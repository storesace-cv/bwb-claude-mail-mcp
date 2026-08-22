import { commsConfig } from "../config.js";
import { applyFolderRules } from "../rules/apply.js";
import { sendDigestIfDue } from "../mail/digest.js";
import { syncAllMail } from "../mail/sync.js";
import { syncAllWhatsapp } from "../whatsapp/sync.js";

export interface JobResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runMailPipeline(): Promise<JobResult[]> {
  const results: JobResult[] = [];
  try {
    const sync = await syncAllMail();
    results.push({
      name: "mail-sync",
      ok: true,
      detail: `${sync.accounts} contas, ${sync.fetched} mensagens novas`,
    });
  } catch (err) {
    results.push({
      name: "mail-sync",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const rules = await applyFolderRules();
    results.push({
      name: "folder-rules",
      ok: true,
      detail: `movidas ${rules.moved}, conflitos ${rules.skippedConflict}`,
    });
  } catch (err) {
    results.push({
      name: "folder-rules",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const digest = await sendDigestIfDue();
    results.push({
      name: "digest",
      ok: true,
      detail: digest.sent ? "enviado" : "não devido",
    });
  } catch (err) {
    results.push({
      name: "digest",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  return results;
}

export async function runWaPipeline(): Promise<JobResult> {
  try {
    const r = await syncAllWhatsapp();
    return {
      name: "wa-sync",
      ok: true,
      detail: `${r.accounts} contas, ${r.inserted} novas`,
    };
  } catch (err) {
    return {
      name: "wa-sync",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function startSchedulers(): void {
  setInterval(() => {
    void runMailPipeline();
  }, commsConfig.mailSyncMs);
  setInterval(() => {
    void runWaPipeline();
  }, commsConfig.waSyncMs);
  setTimeout(() => {
    void runMailPipeline();
    void runWaPipeline();
  }, 15_000);
}
