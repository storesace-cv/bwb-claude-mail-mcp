import { commsConfig } from "../config.js";
import { runWeekdayInboxTriage, runWeekdayInboxTriageIfDue } from "../mail/weekday-triage.js";
import { applyFolderRules } from "../rules/apply.js";
import { syncAllMail } from "../mail/sync.js";
import { runAgtKb, runAgtKbIfDue } from "../whatsapp/agt-kb.js";
import { syncAllWhatsapp } from "../whatsapp/sync.js";
import { jobError, jobLog, jobProgress, jobStep } from "./progress.js";
import { mailAttachmentGateError } from "../settings.js";

export interface JobResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runMailPipeline(): Promise<JobResult[]> {
  const results: JobResult[] = [];
  const gate = mailAttachmentGateError();
  if (gate) {
    jobError(gate);
    return [{ name: "mail-sync", ok: false, detail: gate }];
  }
  jobStep("sync", "Ler mensagens novas");
  jobLog("A iniciar leitura das caixas de correio.");
  try {
    const sync = await syncAllMail();
    results.push({
      name: "mail-sync",
      ok: true,
      detail: `${sync.fetched} mensagens novas em ${sync.accounts} contas`,
    });
    jobLog(`Leitura concluída: ${sync.fetched} novas em ${sync.accounts} contas.`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    jobError(`Leitura do correio falhou: ${detail}`);
    results.push({ name: "mail-sync", ok: false, detail });
  }
  jobStep("rules", "Aplicar regras de pastas");
  jobProgress(72);
  jobLog("A aplicar regras de pastas.");
  try {
    const rules = await applyFolderRules();
    results.push({
      name: "folder-rules",
      ok: true,
      detail: `${rules.moved} mensagens movidas. ${rules.skippedConflict} não movidas porque várias regras apontavam para pastas diferentes.`,
    });
    jobLog(`Regras: ${rules.moved} movidas, ${rules.skippedConflict} conflitos.`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    jobError(`Regras de pastas falharam: ${detail}`);
    results.push({ name: "folder-rules", ok: false, detail });
  }
  jobProgress(100);
  return results;
}

export async function runWaPipeline(): Promise<JobResult> {
  jobStep("sync", "Ler mensagens das vigias");
  jobLog("A ler o arquivo WhatsApp.");
  try {
    const r = await syncAllWhatsapp();
    jobLog(`${r.inserted} mensagens novas em ${r.accounts} contas.`);
    jobProgress(100);
    return {
      name: "wa-sync",
      ok: true,
      detail: `${r.inserted} mensagens novas em ${r.accounts} contas`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    jobError(`WhatsApp falhou: ${detail}`);
    return {
      name: "wa-sync",
      ok: false,
      detail,
    };
  }
}

export async function runScheduledTasks(): Promise<JobResult[]> {
  const out: JobResult[] = [];
  try {
    const t = await runWeekdayInboxTriageIfDue();
    out.push({ name: "organizar-inbox", ok: true, detail: t.ran ? t.detail : t.detail });
  } catch (err) {
    out.push({
      name: "organizar-inbox",
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
  jobStep("unread", "Listar não lidos");
  jobLog("A iniciar organização da INBOX.");
  try {
    const text = await runWeekdayInboxTriage();
    jobProgress(100);
    return { name: "organizar-inbox", ok: true, detail: text };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    jobError(`Organizar INBOX falhou: ${detail}`);
    return {
      name: "organizar-inbox",
      ok: false,
      detail,
    };
  }
}

export async function runAgtNow(): Promise<JobResult> {
  jobStep("chats", "Percorrer conversas");
  jobLog("A iniciar actualização da base de conhecimento.");
  try {
    const text = await runAgtKb();
    jobProgress(100);
    return { name: "agt-kb", ok: true, detail: text };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    jobError(`Base de conhecimento falhou: ${detail}`);
    return {
      name: "agt-kb",
      ok: false,
      detail,
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
