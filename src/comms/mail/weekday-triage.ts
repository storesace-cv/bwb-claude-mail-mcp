import { listMailAccounts } from "../accounts.js";
import { getCursor, setCursor } from "../db.js";
import { getSchedule, listMailRules } from "../rules/store.js";
import { lisbonParts, shouldFireDaily } from "../time/lisbon.js";
import { fileHelpdeskMail } from "./helpdesk-file.js";
import { listEnvelopes, loadLayout, openImap, searchUids } from "./imap.js";
import { fileAndPurgePromo } from "./newsletter-purge.js";
import { sendCommsMail } from "./send.js";

const CURSOR = "schedule:triage";

export async function runWeekdayInboxTriageIfDue(): Promise<{ ran: boolean; detail: string }> {
  const schedule = getSchedule("triage");
  if (!schedule?.enabled) return { ran: false, detail: "agendamento desligado" };
  if (
    !shouldFireDaily({
      lastDateKey: getCursor(CURSOR) ?? getCursor("schedule:weekday-inbox-triage"),
      hour: schedule.hour,
      weekdaysOnly: schedule.weekdaysOnly,
    })
  ) {
    return { ran: false, detail: "não devido" };
  }
  const report = await runWeekdayInboxTriage({ notify: true });
  setCursor(CURSOR, lisbonParts().dateKey);
  return { ran: true, detail: report.slice(0, 200) };
}

export async function runWeekdayInboxTriage(opts?: { notify?: boolean }): Promise<string> {
  const accounts = await listMailAccounts();
  const sections: string[] = [
    `Triage INBOX — ${lisbonParts().dateKey} (Europe/Lisbon)`,
    "Sem rascunhos automáticos. Não lidos ficam no relatório.",
    "",
  ];
  for (const account of accounts) {
    sections.push(`## ${account.label} (${account.mail.defaultFrom})`);
    try {
      const client = await openImap(account);
      try {
        await loadLayout(client);
        const unreadUids = await searchUids(client, "INBOX", { seen: false });
        const unread = await listEnvelopes(client, "INBOX", unreadUids.slice(0, 100));
        if (!unread.length) {
          sections.push("Part A: sem não lidos.");
        } else {
          sections.push(`Part A: ${unread.length} não lidos (máx. 100):`);
          for (const m of unread) {
            sections.push(`- ${m.fromHeader} — ${m.subject}`);
          }
        }
        const helpdeskOn = listMailRules(true).some((r) => r.kind === "helpdesk");
        if (helpdeskOn) {
          const hd = await fileHelpdeskMail(client, account);
          sections.push("Helpdesk organizado:");
          const entries = Object.entries(hd.byFolder);
          if (!entries.length) sections.push("- nada a arquivar");
          for (const [folder, n] of entries) {
            sections.push(`- ${folder}: ${n} mensagens`);
          }
          if (hd.unclassified) {
            sections.push(`- _sem-cliente: ${hd.unclassified} (rever)`);
          }
        }
        const promo = await fileAndPurgePromo(client, account.id);
        sections.push("Newsletters & Marketing:");
        const filed = Object.entries(promo.filed);
        sections.push(
          filed.length
            ? filed.map(([k, n]) => `- filed ${k}: ${n}`).join("\n")
            : "- nada a arquivar"
        );
        const purged = Object.entries(promo.purged);
        for (const [k, n] of purged) {
          sections.push(`- purge ${k}: ${n}`);
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch (err) {
      sections.push(`Erro de acesso: ${err instanceof Error ? err.message : String(err)}`);
    }
    sections.push("");
  }
  const text = sections.join("\n");
  if (opts?.notify) {
    await sendCommsMail(`[BWB Comms] Triage INBOX ${lisbonParts().dateKey}`, text);
  }
  return text;
}
