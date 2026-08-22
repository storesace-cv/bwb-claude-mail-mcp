import { Router } from "express";
import { createReadStream } from "node:fs";
import { listMailAccounts } from "../accounts.js";
import { forceChangePassword, getAdmin, verifyAdminCredentials } from "../admin-store.js";
import { getDb, getCursor } from "../db.js";
import { esc, header, layout } from "../html.js";
import { runAgtNow, runMailPipeline, runWaPipeline, runWeekdayNow } from "../jobs/run.js";
import { buildChatGptPack } from "../pack.js";
import { loadRules, saveRules } from "../rules/apply.js";
import {
  deleteMailRule,
  duplicateMailRule,
  deleteWaWatch,
  getMailRule,
  insertMailRule,
  listCachedFolders,
  listMailRules,
  listSchedules,
  listWaWatches,
  setMailRuleEnabled,
  updateMailRule,
  updateSchedule,
  upsertWaWatch,
  type MailRule,
} from "../rules/store.js";
import { checkCsrf, clearSessionCookie, requireAdminSession, setSessionCookie } from "../session.js";
import { listWaChats } from "../whatsapp/chats.js";
import { listAllowlist, removeAllow, upsertAllow } from "../whatsapp/store.js";
import { listWaAccounts } from "../whatsapp/sync.js";
import type { FolderRule } from "../rules/match.js";

export const adminRouter = Router();

adminRouter.get("/login", (_req, res) => {
  res.type("html").send(
    layout(
      "Entrar",
      `<div class="panel narrow"><h2>BWB Comms</h2>
      <form method="post" action="/admin/login" class="stack">
        <label>Email <input name="email" type="email" required></label>
        <label>Senha <input name="password" type="password" required></label>
        <div class="actions"><button type="submit">Entrar</button></div>
      </form></div>`
    )
  );
});

adminRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "");
  const password = String(req.body?.password ?? "");
  const admin = await verifyAdminCredentials(email, password);
  if (!admin) {
    res.status(401).type("html").send(layout("Entrar", "<p>Credenciais inválidas.</p>", { error: "Falhou" }));
    return;
  }
  setSessionCookie(res, admin.email, admin.sessionVersion);
  if (admin.mustChangePassword) {
    res.redirect("/admin/change-password");
    return;
  }
  res.redirect("/admin");
});

adminRouter.get("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.redirect("/admin/login");
});

adminRouter.use(requireAdminSession);

adminRouter.get("/change-password", (_req, res) => {
  res.type("html").send(
    layout(
      "Nova senha",
      `${header("jobs")}
      <div class="panel narrow">
        <form method="post" action="/admin/change-password" class="stack">
          <label>Nova senha <input name="password" type="password" minlength="10" required></label>
          <div class="actions"><button type="submit">Guardar</button></div>
        </form>
      </div>`
    )
  );
});

adminRouter.post("/change-password", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  try {
    const admin = await forceChangePassword(String(req.body?.password ?? ""));
    setSessionCookie(res, admin.email, admin.sessionVersion);
    res.redirect("/admin");
  } catch (err) {
    res.type("html").send(
      layout("Nova senha", header("jobs"), {
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
});

adminRouter.get("/", (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT t.account_id, t.thread_key, t.subject, t.last_inbound_at, t.last_outbound_at,
              (SELECT m.from_header FROM mail_messages m
               WHERE m.account_id = t.account_id AND m.thread_key = t.thread_key
               ORDER BY m.date_ms DESC LIMIT 1) AS from_header
       FROM mail_threads t WHERE t.unanswered = 1
       ORDER BY t.last_inbound_at DESC LIMIT 80`
    )
    .all() as Array<{
    account_id: string;
    thread_key: string;
    subject: string;
    last_inbound_at: number | null;
    last_outbound_at: number | null;
    from_header: string;
  }>;
  const body = `${header("unanswered")}
    <div class="panel">
      <h2>Não respondidos (${rows.length})</h2>
      <table>
        <thead><tr><th>Conta</th><th>De</th><th>Assunto</th><th>Último inbound</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td class="mono">${esc(r.account_id)}</td>
                <td>${esc(r.from_header ?? "")}</td>
                <td>${esc(r.subject)}</td>
                <td class="muted">${r.last_inbound_at ? esc(new Date(r.last_inbound_at).toISOString()) : ""}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  res.type("html").send(layout("Não respondidos", body));
});

adminRouter.get("/invoices", (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, account_id, filename, mime, created_at FROM invoices ORDER BY created_at DESC LIMIT 80`
    )
    .all() as Array<{
    id: number;
    account_id: string;
    filename: string;
    mime: string;
    created_at: number;
  }>;
  const body = `${header("invoices")}
    <div class="panel">
      <h2>Facturas</h2>
      <table>
        <thead><tr><th>Ficheiro</th><th>Conta</th><th>Data</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${esc(r.filename)}</td>
                <td class="mono">${esc(r.account_id)}</td>
                <td class="muted">${esc(new Date(r.created_at).toISOString())}</td>
                <td><a href="/admin/invoices/${r.id}/file">abrir</a></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  res.type("html").send(layout("Facturas", body));
});

adminRouter.get("/invoices/:id/file", (req, res) => {
  const id = Number(req.params.id);
  const row = getDb()
    .prepare("SELECT path, filename, mime FROM invoices WHERE id = ?")
    .get(id) as { path: string; filename: string; mime: string } | undefined;
  if (!row) {
    res.status(404).send("not found");
    return;
  }
  res.setHeader("Content-Type", row.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${row.filename.replace(/"/g, "")}"`);
  createReadStream(row.path).pipe(res);
});

adminRouter.get("/whatsapp", async (req, res) => {
  const accounts = await listWaAccounts();
  const accountId = String(req.query.account ?? accounts[0]?.id ?? "a");
  const chats = await listWaChats(accountId);
  const watches = listWaWatches();
  const allow = listAllowlist();
  const msgs = getDb()
    .prepare(
      `SELECT account_id, chat_jid, sender, substr(body,1,240) AS body, ts
       FROM wa_messages ORDER BY ts DESC LIMIT 80`
    )
    .all() as Array<{
    account_id: string;
    chat_jid: string;
    sender: string;
    body: string;
    ts: number;
  }>;
  const chatName = (jid: string) => chats.find((c) => c.jid === jid)?.name;
  const body = `${header("whatsapp")}
    <div class="panel">
      <h2>Vigias</h2>
      <p class="muted">Escolhe a conta e a conversa pelo nome. O identificador interno não é pedido.</p>
      <form method="get" action="/admin/whatsapp" class="row">
        <label>Conta
          <select name="account" onchange="this.form.submit()">
            ${accounts
              .map(
                (a) =>
                  `<option value="${esc(a.id)}" ${a.id === accountId ? "selected" : ""}>${esc(a.label)}</option>`
              )
              .join("")}
          </select>
        </label>
      </form>
      <form method="post" action="/admin/whatsapp/watch" class="stack">
        <input type="hidden" name="account_id" value="${esc(accountId)}">
        <label>Conversa
          <select name="chat_jid" required>
            ${chats
              .map((c) => `<option value="${esc(c.jid)}">${esc(c.name)}</option>`)
              .join("")}
          </select>
        </label>
        <label>Palavras-chave (separadas por vírgula)
          <input name="keywords" placeholder="IVA, SAFT-AO, certificação">
        </label>
        <label><input type="checkbox" name="kb_enabled" checked> Actualizar base de conhecimento</label>
        <div class="actions"><button type="submit">Vigiar</button></div>
      </form>
      <table>
        <thead><tr><th>Conta</th><th>Conversa</th><th>Palavras-chave</th><th>KB</th><th></th></tr></thead>
        <tbody>
          ${watches
            .map(
              (w) => `<tr>
                <td>${esc(accounts.find((a) => a.id === w.accountId)?.label ?? w.accountId)}</td>
                <td>${esc(w.label || chatName(w.chatJid) || w.chatJid)}</td>
                <td>${esc(w.keywords)}</td>
                <td>${w.kbEnabled ? "sim" : "não"}</td>
                <td>
                  <form method="post" action="/admin/whatsapp/watch/delete" class="inline-form">
                    <input type="hidden" name="id" value="${w.id}">
                    <button class="secondary" type="submit">Remover</button>
                  </form>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Arquivo recente</h2>
      <p class="muted">Só conversas vigiadas entram no arquivo. Usa KB draft para criar uma entrada.</p>
      <table>
        <thead><tr><th>Quando</th><th>Chat</th><th>Quem</th><th>Texto</th><th></th></tr></thead>
        <tbody>
          ${msgs
            .map(
              (m) => `<tr>
                <td class="muted">${esc(new Date(m.ts).toISOString())}</td>
                <td>${esc(allow.find((a) => a.chat_jid === m.chat_jid)?.label || m.chat_jid)}</td>
                <td>${esc(m.sender)}</td>
                <td>${esc(m.body)}</td>
                <td>
                  <form method="post" action="/admin/kb/from-wa">
                    <input type="hidden" name="account_id" value="${esc(m.account_id)}">
                    <input type="hidden" name="chat_jid" value="${esc(m.chat_jid)}">
                    <input type="hidden" name="body" value="${esc(m.body)}">
                    <button class="secondary" type="submit">KB draft</button>
                  </form>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  res.type("html").send(layout("WhatsApp", body));
});

adminRouter.post("/whatsapp/watch", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const accountId = String(req.body.account_id ?? "a");
  const chatJid = String(req.body.chat_jid ?? "").trim();
  const chats = await listWaChats(accountId);
  const chat = chats.find((c) => c.jid === chatJid);
  const label = chat?.name || chatJid;
  upsertWaWatch({
    accountId,
    chatJid,
    label,
    keywords: String(req.body.keywords ?? ""),
    kbEnabled: Boolean(req.body.kb_enabled),
    enabled: true,
  });
  upsertAllow(accountId, chatJid, label);
  res.redirect("/admin/whatsapp?account=" + encodeURIComponent(accountId));
});

adminRouter.post("/whatsapp/watch/delete", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const id = Number(req.body.id);
  const watch = listWaWatches().find((w) => w.id === id);
  if (watch) {
    deleteWaWatch(id);
    removeAllow(watch.accountId, watch.chatJid);
  }
  res.redirect("/admin/whatsapp");
});

adminRouter.get("/kb", (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, title, problem, solution, tags, source_type, status FROM kb_items ORDER BY created_at DESC LIMIT 80`
    )
    .all() as Array<{
    id: number;
    title: string;
    problem: string;
    solution: string;
    tags: string;
    source_type: string;
    status: string;
  }>;
  const body = `${header("kb")}
    <div class="panel">
      <h2>Nova entrada</h2>
      <form method="post" action="/admin/kb" class="stack">
        <label>Título <input name="title"></label>
        <label>Problema <textarea name="problem"></textarea></label>
        <label>Solução <textarea name="solution"></textarea></label>
        <label>Tags <input name="tags"></label>
        <div class="actions"><button type="submit">Criar draft</button></div>
      </form>
    </div>
    <div class="panel">
      <h2>Itens</h2>
      <table>
        <thead><tr><th>#</th><th>Título</th><th>Estado</th><th>Fonte</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${r.id}</td>
                <td>${esc(r.title || "(sem título)")}</td>
                <td><span class="badge">${esc(r.status)}</span></td>
                <td>${esc(r.source_type)}</td>
                <td><a href="/admin/kb/${r.id}">editar</a></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  res.type("html").send(layout("KB", body));
});

adminRouter.post("/kb", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO kb_items (title, problem, solution, tags, source_type, source_ref, status, created_at)
       VALUES (?,?,?,?, 'manual', '', 'draft', ?)`
    )
    .run(
      String(req.body.title ?? ""),
      String(req.body.problem ?? ""),
      String(req.body.solution ?? ""),
      String(req.body.tags ?? ""),
      Date.now()
    );
  res.redirect("/admin/kb");
});

adminRouter.post("/kb/from-wa", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const ref = `${req.body.account_id}:${req.body.chat_jid}`;
  getDb()
    .prepare(
      `INSERT INTO kb_items (title, problem, solution, tags, source_type, source_ref, status, created_at)
       VALUES (?,?,?,?, 'wa', ?, 'draft', ?)`
    )
    .run("", String(req.body.body ?? ""), "", "", ref, Date.now());
  res.redirect("/admin/kb");
});

adminRouter.get("/kb/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = getDb()
    .prepare("SELECT * FROM kb_items WHERE id = ?")
    .get(id) as
    | {
        id: number;
        title: string;
        problem: string;
        solution: string;
        tags: string;
        status: string;
      }
    | undefined;
  if (!row) {
    res.status(404).send("not found");
    return;
  }
  const body = `${header("kb")}
    <div class="panel">
      <form method="post" action="/admin/kb/${row.id}" class="stack">
        <label>Título <input name="title" value="${esc(row.title)}"></label>
        <label>Problema <textarea name="problem">${esc(row.problem)}</textarea></label>
        <label>Solução <textarea name="solution">${esc(row.solution)}</textarea></label>
        <label>Tags <input name="tags" value="${esc(row.tags)}"></label>
        <label>Estado
          <select name="status">
            <option value="draft" ${row.status === "draft" ? "selected" : ""}>draft</option>
            <option value="accepted" ${row.status === "accepted" ? "selected" : ""}>accepted</option>
          </select>
        </label>
        <div class="actions"><button type="submit">Guardar</button></div>
      </form>
    </div>`;
  res.type("html").send(layout(`KB #${row.id}`, body));
});

adminRouter.post("/kb/:id", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const id = Number(req.params.id);
  getDb()
    .prepare(
      `UPDATE kb_items SET title=?, problem=?, solution=?, tags=?, status=? WHERE id=?`
    )
    .run(
      String(req.body.title ?? ""),
      String(req.body.problem ?? ""),
      String(req.body.solution ?? ""),
      String(req.body.tags ?? ""),
      String(req.body.status ?? "draft"),
      id
    );
  res.redirect("/admin/kb");
});

adminRouter.get("/rules", async (_req, res) => {
  const accounts = await listMailAccounts();
  const rules = listMailRules();
  const schedules = listSchedules();
  const folders = uniqueFolders(listCachedFolders());
  const senders = recentSenders();
  const extra = await loadRules();
  const body = `${header("rules")}
    <div class="panel">
      <h2>Agendamentos</h2>
      <p class="muted">Hora em Europe/Lisbon. Catch-up se o serviço estiver em baixo.</p>
      ${schedules
        .map(
          (s) => `<form method="post" action="/admin/schedules/${esc(s.id)}" class="row" style="margin-bottom:1rem">
            <label>Título <input name="title" value="${esc(s.title)}"></label>
            <label>Hora
              <select name="hour">
                ${hourOptions(s.hour)}
              </select>
            </label>
            <label>Dias
              <select name="weekdays_only">
                <option value="1" ${s.weekdaysOnly ? "selected" : ""}>Dias úteis</option>
                <option value="0" ${!s.weekdaysOnly ? "selected" : ""}>Todos os dias</option>
              </select>
            </label>
            <label>Estado
              <select name="enabled">
                <option value="1" ${s.enabled ? "selected" : ""}>Ligado</option>
                <option value="0" ${!s.enabled ? "selected" : ""}>Desligado</option>
              </select>
            </label>
            <div class="actions"><button type="submit">Guardar</button></div>
          </form>`
        )
        .join("")}
    </div>
    <div class="panel">
      <h2>Nova regra de mail</h2>
      <p class="muted">Conta, remetente recente e pasta IMAP vêm das caixas já sincronizadas.</p>
      ${ruleForm({ accounts, folders, senders })}
    </div>
    <div class="panel">
      <h2>Regras activas</h2>
      <div class="table-scroll">
      <table class="one-line">
        <thead><tr>
          <th>Editar</th>
          <th>Duplicar</th>
          <th>Estado</th>
          <th>Apagar</th>
          <th>#</th>
          <th>Nome</th>
          <th>Tipo</th>
          <th>Conta</th>
          <th>From</th>
          <th>Assunto</th>
          <th>Prefixo</th>
          <th>Domínio</th>
          <th>Pasta</th>
          <th>Purge</th>
          <th>Só promo</th>
          <th>Catch promo</th>
          <th>Catch digest</th>
          <th>Odoo notif.</th>
          <th>Facturas</th>
          <th>Segurança</th>
          <th>Ligado</th>
        </tr></thead>
        <tbody>
          ${rules
            .map((r) => {
              const acc =
                r.accountId === "*"
                  ? "Todas"
                  : accounts.find((a) => a.id === r.accountId)?.label || r.accountId;
              return `<tr>
                <td><a class="btn secondary" href="/admin/rules/${r.id}">Editar</a></td>
                <td><form method="post" action="/admin/rules/${r.id}/duplicate"><button class="secondary" type="submit">Duplicar</button></form></td>
                <td><form method="post" action="/admin/rules/${r.id}/toggle"><button class="secondary" type="submit">${r.enabled ? "Desligar" : "Ligar"}</button></form></td>
                <td><form method="post" action="/admin/rules/${r.id}/delete"><button class="secondary" type="submit">Apagar</button></form></td>
                <td class="mono">${r.id}</td>
                <td>${esc(r.name)}</td>
                <td>${esc(kindLabel(r.kind))}</td>
                <td>${esc(acc)}</td>
                <td>${esc(dash(r.matchFrom))}</td>
                <td>${esc(dash(r.matchSubject))}</td>
                <td>${esc(dash(r.subjectPrefix))}</td>
                <td>${esc(dash(r.fromDomain))}</td>
                <td>${esc(dash(r.destFolder))}</td>
                <td>${r.purgeAfterDays || "—"}</td>
                <td>${yn(r.splitPromo)}</td>
                <td>${yn(r.catchPromo)}</td>
                <td>${yn(r.catchDigest)}</td>
                <td>${yn(r.odooNotifications)}</td>
                <td>${yn(r.catchInvoice)}</td>
                <td>${yn(r.catchSecurity)}</td>
                <td>${r.enabled ? "sim" : "não"}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      </div>
    </div>
    <div class="panel">
      <h2>Arquivo extra (pasta exacta)</h2>
      <p class="muted">Uma regra só move se o destino for único. Dois destinos para o mesmo mail = não move.</p>
      <form method="post" action="/admin/folder-rules" class="stack">
        <div class="row">
          <label>Conta
            <select name="accountId">
              <option value="*">Todas</option>
              ${accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join("")}
            </select>
          </label>
          <label>Pasta destino
            <select name="destFolder">
              ${folders.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="row">
          <label>Remetente
            <select name="matchFrom">
              <option value="">(qualquer)</option>
              ${senders.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
            </select>
          </label>
          <label>Assunto contém <input name="matchSubject"></label>
        </div>
        <div class="actions"><button type="submit">Adicionar</button></div>
      </form>
      <table>
        <thead><tr><th>Conta</th><th>From</th><th>Assunto</th><th>Destino</th><th></th></tr></thead>
        <tbody>
          ${extra
            .map(
              (r) => `<tr>
                <td>${esc(r.accountId)}</td>
                <td>${esc(r.matchFrom)}</td>
                <td>${esc(r.matchSubject)}</td>
                <td class="mono">${esc(r.destFolder)}</td>
                <td>
                  <form method="post" action="/admin/folder-rules/delete">
                    <input type="hidden" name="id" value="${esc(r.id)}">
                    <button class="secondary" type="submit">Apagar</button>
                  </form>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  res.type("html").send(layout("Regras", body, { wrapClass: "wide" }));
});

adminRouter.get("/rules/:id", async (req, res) => {
  const rule = getMailRule(Number(req.params.id));
  if (!rule) {
    res.status(404).send("not found");
    return;
  }
  const accounts = await listMailAccounts();
  const folders = uniqueFolders(listCachedFolders(rule.accountId));
  const senders = recentSenders();
  const body = `${header("rules")}
    <div class="panel">
      <h2>Editar regra</h2>
      ${ruleForm({ accounts, folders, senders, rule, action: `/admin/rules/${rule.id}` })}
    </div>`;
  res.type("html").send(layout("Editar regra", body));
});

adminRouter.post("/rules", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  insertMailRule(parseMailRule(req.body));
  res.redirect("/admin/rules");
});

adminRouter.post("/rules/:id", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const id = Number(req.params.id);
  updateMailRule({ ...parseMailRule(req.body), id });
  res.redirect("/admin/rules");
});

adminRouter.post("/rules/:id/toggle", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const id = Number(req.params.id);
  const rule = getMailRule(id);
  if (rule) setMailRuleEnabled(id, !rule.enabled);
  res.redirect("/admin/rules");
});

adminRouter.post("/rules/:id/duplicate", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const copyId = duplicateMailRule(Number(req.params.id));
  if (!copyId) {
    res.status(404).send("not found");
    return;
  }
  res.redirect(`/admin/rules/${copyId}`);
});

adminRouter.post("/rules/:id/delete", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  deleteMailRule(Number(req.params.id));
  res.redirect("/admin/rules");
});

adminRouter.post("/folder-rules", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const rules = await loadRules();
  const rule: FolderRule = {
    id: String(Date.now()),
    accountId: String(req.body.accountId ?? "*").trim() || "*",
    matchFrom: String(req.body.matchFrom ?? ""),
    matchSubject: String(req.body.matchSubject ?? ""),
    destFolder: String(req.body.destFolder ?? "").trim(),
  };
  rules.push(rule);
  await saveRules(rules);
  res.redirect("/admin/rules");
});

adminRouter.post("/folder-rules/delete", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const id = String(req.body.id);
  const rules = (await loadRules()).filter((r) => r.id !== id);
  await saveRules(rules);
  res.redirect("/admin/rules");
});

adminRouter.post("/schedules/:id", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const current = listSchedules().find((s) => s.id === req.params.id);
  if (!current) {
    res.status(404).send("not found");
    return;
  }
  updateSchedule({
    ...current,
    title: String(req.body.title ?? current.title),
    hour: Number(req.body.hour ?? current.hour),
    weekdaysOnly: String(req.body.weekdays_only) === "1",
    enabled: String(req.body.enabled) !== "0",
  });
  res.redirect("/admin/rules");
});

adminRouter.get("/jobs", async (_req, res) => {
  const admin = await getAdmin();
  const schedules = listSchedules();
  const body = `${header("jobs")}
    <div class="panel">
      <p class="muted">Sessão: ${esc(admin.email)}. Os jobs também correm sozinhos.</p>
      <table>
        <thead><tr><th>Agendamento</th><th>Hora</th><th>Última corrida</th><th>Estado</th></tr></thead>
        <tbody>
          ${schedules
            .map((s) => {
              const last = getCursor(`schedule:${s.id}`);
              return `<tr>
                <td>${esc(s.title)}</td>
                <td>${String(s.hour).padStart(2, "0")}:00 ${s.weekdaysOnly ? "(úteis)" : "(todos)"}</td>
                <td class="muted">${esc(last ?? "nunca")}</td>
                <td>${s.enabled ? "ligado" : "desligado"}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      <form method="post" action="/admin/jobs/mail" class="actions">
        <button type="submit">Correr mail agora</button>
      </form>
      <form method="post" action="/admin/jobs/wa" class="actions">
        <button class="secondary" type="submit">Correr WhatsApp agora</button>
      </form>
      <form method="post" action="/admin/jobs/triage" class="actions">
        <button type="submit">Correr organizar INBOX agora</button>
      </form>
      <form method="post" action="/admin/jobs/agt" class="actions">
        <button class="secondary" type="submit">Correr base de conhecimento agora</button>
      </form>
    </div>`;
  res.type("html").send(layout("Jobs", body));
});

adminRouter.post("/jobs/mail", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const results = await runMailPipeline();
  res.type("html").send(
    layout(
      "Jobs",
      `${header("jobs")}<div class="panel"><pre class="mono">${esc(JSON.stringify(results, null, 2))}</pre>
      <p><a href="/admin/jobs">voltar</a></p></div>`
    )
  );
});

adminRouter.post("/jobs/wa", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const result = await runWaPipeline();
  res.type("html").send(
    layout(
      "Jobs",
      `${header("jobs")}<div class="panel"><pre class="mono">${esc(JSON.stringify(result, null, 2))}</pre>
      <p><a href="/admin/jobs">voltar</a></p></div>`
    )
  );
});

adminRouter.post("/jobs/triage", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const result = await runWeekdayNow();
  res.type("html").send(
    layout(
      "Jobs",
      `${header("jobs")}<div class="panel"><pre class="mono">${esc(JSON.stringify(result, null, 2))}</pre>
      <p><a href="/admin/jobs">voltar</a></p></div>`
    )
  );
});

adminRouter.post("/jobs/agt", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const result = await runAgtNow();
  res.type("html").send(
    layout(
      "Jobs",
      `${header("jobs")}<div class="panel"><pre class="mono">${esc(JSON.stringify(result, null, 2))}</pre>
      <p><a href="/admin/jobs">voltar</a></p></div>`
    )
  );
});

adminRouter.get("/pack.md", (_req, res) => {
  res.type("text/markdown; charset=utf-8").send(buildChatGptPack());
});

function yn(v: boolean): string {
  return v ? "sim" : "—";
}

function dash(v: string): string {
  return v || "—";
}

function hourOptions(selected: number): string {
  return Array.from({ length: 24 }, (_, h) => {
    const label = `${String(h).padStart(2, "0")}:00`;
    return `<option value="${h}" ${h === selected ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    keep: "Não mover",
    newsletters: "Newsletters",
    marketing: "Marketing",
    helpdesk: "Helpdesk",
    custom: "Pasta",
  };
  return map[kind] ?? kind;
}

function uniqueFolders(cached: string[]): string[] {
  return [...new Set(["newsletters", "marketing", "helpdesk", ...cached])];
}

function recentSenders(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT from_header AS f FROM mail_messages
         WHERE from_me = 0 AND from_header != ''
         GROUP BY from_header ORDER BY MAX(date_ms) DESC LIMIT 80`
      )
      .all() as Array<{ f: string }>
  ).map((r) => r.f);
}

function parseMailRule(body: Record<string, unknown>): Omit<MailRule, "id"> {
  const flag = (k: string) => String(body[k] ?? "") === "on" || String(body[k] ?? "") === "1";
  return {
    name: String(body.name ?? "").trim() || "Regra",
    kind: String(body.kind ?? "custom"),
    accountId: String(body.account_id ?? "*") || "*",
    matchFrom: String(body.match_from ?? ""),
    matchSubject: String(body.match_subject ?? ""),
    subjectPrefix: String(body.subject_prefix ?? ""),
    fromDomain: String(body.from_domain ?? ""),
    destFolder: String(body.dest_folder ?? ""),
    splitPromo: flag("split_promo"),
    catchPromo: flag("catch_promo"),
    catchDigest: flag("catch_digest"),
    odooNotifications: flag("odoo_notifications"),
    catchInvoice: flag("catch_invoice"),
    catchSecurity: flag("catch_security"),
    purgeAfterDays: Number(body.purge_after_days ?? 0) || 0,
    enabled: flag("enabled"),
  };
}

function ruleForm(opts: {
  accounts: Array<{ id: string; label: string }>;
  folders: string[];
  senders: string[];
  rule?: MailRule;
  action?: string;
}): string {
  const r = opts.rule;
  const action = opts.action ?? "/admin/rules";
  const kinds = ["keep", "newsletters", "marketing", "helpdesk", "custom"];
  const checked = (on: boolean) => (on ? "checked" : "");
  return `<form method="post" action="${esc(action)}" class="stack">
    <label>Nome <input name="name" required value="${esc(r?.name ?? "")}"></label>
    <div class="row">
      <label>Tipo
        <select name="kind">
          ${kinds
            .map(
              (k) =>
                `<option value="${k}" ${r?.kind === k ? "selected" : ""}>${esc(kindLabel(k))}</option>`
            )
            .join("")}
        </select>
      </label>
      <label>Conta
        <select name="account_id">
          <option value="*" ${!r || r.accountId === "*" ? "selected" : ""}>Todas</option>
          ${opts.accounts
            .map(
              (a) =>
                `<option value="${esc(a.id)}" ${r?.accountId === a.id ? "selected" : ""}>${esc(a.label)}</option>`
            )
            .join("")}
        </select>
      </label>
    </div>
    <div class="row">
      <label>Remetente (lista recente)
        <input name="match_from" list="senders" value="${esc(r?.matchFrom ?? "")}" placeholder="email ou parte do from">
        <datalist id="senders">
          ${opts.senders.map((s) => `<option value="${esc(s)}"></option>`).join("")}
        </datalist>
      </label>
      <label>Pasta destino
        <select name="dest_folder">
          <option value="">(nenhuma)</option>
          ${opts.folders
            .map(
              (f) =>
                `<option value="${esc(f)}" ${r?.destFolder === f ? "selected" : ""}>${esc(f)}</option>`
            )
            .join("")}
        </select>
      </label>
    </div>
    <label>Purge após N dias (0 = nunca) <input name="purge_after_days" type="number" min="0" value="${r?.purgeAfterDays ?? 0}"></label>
    <div class="row">
      <label>Prefixo assunto <input name="subject_prefix" value="${esc(r?.subjectPrefix ?? "")}"></label>
      <label>Assunto contém / regex <input name="match_subject" value="${esc(r?.matchSubject ?? "")}"></label>
    </div>
    <label>Domínio no from <input name="from_domain" value="${esc(r?.fromDomain ?? "")}"></label>
    <label><input type="checkbox" name="enabled" ${r ? checked(r.enabled) : "checked"}> Ligada</label>
    <label><input type="checkbox" name="split_promo" ${checked(Boolean(r?.splitPromo))}> Só se for promoção</label>
    <label><input type="checkbox" name="catch_promo" ${checked(Boolean(r?.catchPromo))}> Catch texto promocional</label>
    <label><input type="checkbox" name="catch_digest" ${checked(Boolean(r?.catchDigest))}> Catch digest/newsletter</label>
    <label><input type="checkbox" name="odoo_notifications" ${checked(Boolean(r?.odooNotifications))}> Odoo notifications@</label>
    <label><input type="checkbox" name="catch_invoice" ${checked(Boolean(r?.catchInvoice))}> Não mover facturas</label>
    <label><input type="checkbox" name="catch_security" ${checked(Boolean(r?.catchSecurity))}> Não mover segurança</label>
    <div class="actions"><button type="submit">${r ? "Guardar" : "Adicionar"}</button></div>
  </form>`;
}
