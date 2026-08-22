import { getDb } from "./db.js";

export function buildChatGptPack(): string {
  const db = getDb();
  const unanswered = db
    .prepare(
      `SELECT account_id, thread_key, subject, last_inbound_at
       FROM mail_threads WHERE unanswered = 1
       ORDER BY last_inbound_at DESC LIMIT 30`
    )
    .all() as Array<{
    account_id: string;
    thread_key: string;
    subject: string;
    last_inbound_at: number | null;
  }>;
  const invoices = db
    .prepare(
      `SELECT filename, mime, substr(extracted_text, 1, 1200) AS extract
       FROM invoices ORDER BY created_at DESC LIMIT 15`
    )
    .all() as Array<{ filename: string; mime: string; extract: string }>;
  const drafts = db
    .prepare(
      `SELECT id, title, problem, solution, tags, source_type, source_ref, status
       FROM kb_items WHERE status = 'draft' ORDER BY created_at DESC LIMIT 30`
    )
    .all() as Array<{
    id: number;
    title: string;
    problem: string;
    solution: string;
    tags: string;
    source_type: string;
    source_ref: string;
    status: string;
  }>;
  const wa = db
    .prepare(
      `SELECT account_id, chat_jid, sender, body, ts FROM wa_messages
       ORDER BY ts DESC LIMIT 40`
    )
    .all() as Array<{
    account_id: string;
    chat_jid: string;
    sender: string;
    body: string;
    ts: number;
  }>;

  const lines = [
    "# Pack BWB Comms para ChatGPT Pro",
    "",
    "Preenche problema/solução nas drafts da KB. Não peças para enviar mail ou mensagens WhatsApp — as escritas são no servidor.",
    "",
    "## Não respondidos",
    ...unanswered.map(
      (u) =>
        `- [${u.account_id}] ${u.subject} (${u.last_inbound_at ? new Date(u.last_inbound_at).toISOString() : ""})`
    ),
    unanswered.length ? "" : "- (nenhum)",
    "",
    "## Facturas (texto extraído)",
    ...invoices.map(
      (i) => `### ${i.filename} (${i.mime})\n${i.extract || "(sem texto — PDF imagem)"}\n`
    ),
    invoices.length ? "" : "- (nenhuma)",
    "",
    "## KB drafts",
    ...drafts.map(
      (d) =>
        `### #${d.id} ${d.title || "(sem título)"}\nFonte: ${d.source_type} ${d.source_ref}\nProblema:\n${d.problem || "(vazio)"}\nSolução:\n${d.solution || "(vazio)"}\n`
    ),
    drafts.length ? "" : "- (nenhuma)",
    "",
    "## WhatsApp recente (allowlist)",
    ...wa.map(
      (m) =>
        `- [${m.account_id}] ${m.chat_jid} ${new Date(m.ts).toISOString()} ${m.sender}: ${m.body.slice(0, 400)}`
    ),
    wa.length ? "" : "- (nenhuma)",
    "",
  ];
  return lines.join("\n");
}
