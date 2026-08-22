import { commsConfig } from "../config.js";
import { runWeekdayInboxTriage, runWeekdayInboxTriageIfDue } from "../mail/weekday-triage.js";
import { applyFolderRules } from "../rules/apply.js";
import { syncAllMail } from "../mail/sync.js";
import { runAgtKb, runAgtKbIfDue } from "../whatsapp/agt-kb.js";
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

export async function runScheduledTasks(): Promise<JobResult[]> {
  const out: JobResult[] = [];
  try {
    const t = await runWeekdayInboxTriageIfDue();
    out.push({ name: "weekday-inbox-triage", ok: true, detail: t.ran ? t.detail : t.detail });
  } catch (err) {
    out.push({
      name: "weekday-inbox-triage",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const t = await runAgtKbIfDue();
    out.push({ name: "agt-kb", ok: true, detail: t.detail });
  } catch (err) {
    out.push({
      name: "agt-kb",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

export async function runWeekdayNow(): Promise<JobResult> {
  try {
    const text = await runWeekdayInboxTriage();
    return { name: "weekday-inbox-triage", ok: true, detail: text.slice(0, 500) };
  } catch (err) {
    return {
      name: "weekday-inbox-triage",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAgtNow(): Promise<JobResult> {
  try {
    const text = await runAgtKb();
    return { name: "agt-kb", ok: true, detail: text.slice(0, 500) };
  } catch (err) {
    return {
      name: "agt-kb",
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
  setInterval(() => {
    void runScheduledTasks();
  }, 60_000);
  setTimeout(() => {
    void runMailPipeline();
    void runWaPipeline();
    void runScheduledTasks();
  }, 15_000);
}
