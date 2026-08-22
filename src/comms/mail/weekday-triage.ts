import { listMailAccounts } from "../accounts.js";
import { getCursor, setCursor } from "../db.js";
import { lisbonParts, shouldFireDaily } from "../time/lisbon.js";
import { fileHelpdeskMail } from "./helpdesk-file.js";
import { listEnvelopes, loadLayout, openImap, searchUids } from "./imap.js";
import { fileAndPurgePromo } from "./newsletter-purge.js";
import { sendCommsMail } from "./send.js";

const CURSOR = "schedule:weekday-inbox-triage";

export async function runWeekdayInboxTriageIfDue(): Promise<{ ran: boolean; detail: string }> {
  if (
    !shouldFireDaily({
      lastDateKey: getCursor(CURSOR),
      hour: 7,
      weekdaysOnly: true,
    })
  ) {
    return { ran: false, detail: "não devido" };
  }
  const report = await runWeekdayInboxTriage();
  setCursor(CURSOR, lisbonParts().dateKey);
  return { ran: true, detail: report.slice(0, 200) };
}

export async function runWeekdayInboxTriage(): Promise<string> {
  const accounts = await listMailAccounts();
  const sections: string[] = [
    `Triage INBOX — ${lisbonParts().dateKey} (Europe/Lisbon)`,
    "Rascunhos automáticos do Claude NÃO são criados aqui (sem LLM). Não lidos ficam no relatório.",
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
        const promo = await fileAndPurgePromo(client);
        sections.push("Newsletters & Marketing:");
        sections.push(
          `- filed newsletters ${promo.filedNewsletters}, marketing ${promo.filedMarketing}`
        );
        sections.push(
          `- purged (>8d) newsletters ${promo.purgedNewsletters}, marketing ${promo.purgedMarketing}`
        );
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch (err) {
      sections.push(`Erro de acesso: ${err instanceof Error ? err.message : String(err)}`);
    }
    sections.push("");
  }
  const text = sections.join("\n");
  await sendCommsMail(`[BWB Comms] Triage INBOX ${lisbonParts().dateKey}`, text);
  return text;
}
