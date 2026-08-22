import { Router } from "express";
import { createReadStream } from "node:fs";
import { forceChangePassword, getAdmin, verifyAdminCredentials } from "../admin-store.js";
import { getDb } from "../db.js";
import { esc, header, layout } from "../html.js";
import { runMailPipeline, runWaPipeline } from "../jobs/run.js";
import { buildChatGptPack } from "../pack.js";
import { loadRules, saveRules } from "../rules/apply.js";
import { checkCsrf, clearSessionCookie, requireAdminSession, setSessionCookie } from "../session.js";
import { listAllowlist, removeAllow, upsertAllow } from "../whatsapp/store.js";
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

adminRouter.get("/whatsapp", (_req, res) => {
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
  const body = `${header("whatsapp")}
    <div class="panel">
      <h2>Allowlist</h2>
      <form method="post" action="/admin/whatsapp/allow" class="stack">
        <div class="row">
          <label>Conta (a/b) <input name="account_id" value="a" required></label>
          <label>JID do grupo/contacto <input name="chat_jid" required placeholder="120363...@g.us"></label>
        </div>
        <label>Nome <input name="label" required></label>
        <div class="actions"><button type="submit">Adicionar</button></div>
      </form>
      <table>
        <thead><tr><th>Conta</th><th>JID</th><th>Nome</th><th></th></tr></thead>
        <tbody>
          ${allow
            .map(
              (a) => `<tr>
                <td>${esc(a.account_id)}</td>
                <td class="mono">${esc(a.chat_jid)}</td>
                <td>${esc(a.label)}</td>
                <td>
                  <form method="post" action="/admin/whatsapp/allow/delete" class="inline-form">
                    <input type="hidden" name="account_id" value="${esc(a.account_id)}">
                    <input type="hidden" name="chat_jid" value="${esc(a.chat_jid)}">
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
      <p class="muted">Selecciona linhas na KB para criar drafts. Só grupos na allowlist entram.</p>
      <table>
        <thead><tr><th>Quando</th><th>Chat</th><th>Quem</th><th>Texto</th><th></th></tr></thead>
        <tbody>
          ${msgs
            .map(
              (m) => `<tr>
                <td class="muted">${esc(new Date(m.ts).toISOString())}</td>
                <td class="mono">${esc(m.chat_jid)}</td>
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

adminRouter.post("/whatsapp/allow", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  upsertAllow(String(req.body.account_id), String(req.body.chat_jid), String(req.body.label ?? ""));
  res.redirect("/admin/whatsapp");
});

adminRouter.post("/whatsapp/allow/delete", (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  removeAllow(String(req.body.account_id), String(req.body.chat_jid));
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
  const rules = await loadRules();
  const body = `${header("rules")}
    <div class="panel">
      <p class="muted">Uma regra só move se o destino for único. Dois destinos para o mesmo mail = não move.</p>
      <form method="post" action="/admin/rules" class="stack">
        <div class="row">
          <label>Conta (* ou id) <input name="accountId" value="*"></label>
          <label>Pasta destino <input name="destFolder" required placeholder="INBOX.clientes.X"></label>
        </div>
        <div class="row">
          <label>From contém <input name="matchFrom"></label>
          <label>Assunto contém <input name="matchSubject"></label>
        </div>
        <div class="actions"><button type="submit">Adicionar</button></div>
      </form>
      <table>
        <thead><tr><th>Id</th><th>Conta</th><th>From</th><th>Assunto</th><th>Destino</th><th></th></tr></thead>
        <tbody>
          ${rules
            .map(
              (r) => `<tr>
                <td class="mono">${esc(r.id)}</td>
                <td>${esc(r.accountId)}</td>
                <td>${esc(r.matchFrom)}</td>
                <td>${esc(r.matchSubject)}</td>
                <td class="mono">${esc(r.destFolder)}</td>
                <td>
                  <form method="post" action="/admin/rules/delete">
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
  res.type("html").send(layout("Regras", body));
});

adminRouter.post("/rules", async (req, res) => {
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

adminRouter.post("/rules/delete", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const id = String(req.body.id);
  const rules = (await loadRules()).filter((r) => r.id !== id);
  await saveRules(rules);
  res.redirect("/admin/rules");
});

adminRouter.get("/jobs", async (_req, res) => {
  const admin = await getAdmin();
  const body = `${header("jobs")}
    <div class="panel">
      <p class="muted">Sessão: ${esc(admin.email)}. Jobs também correm sozinhos no processo.</p>
      <form method="post" action="/admin/jobs/mail" class="actions">
        <button type="submit">Correr mail agora</button>
      </form>
      <form method="post" action="/admin/jobs/wa" class="actions">
        <button class="secondary" type="submit">Correr WhatsApp agora</button>
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

adminRouter.get("/pack.md", (_req, res) => {
  res.type("text/markdown; charset=utf-8").send(buildChatGptPack());
});
