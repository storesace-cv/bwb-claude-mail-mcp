import { Router } from "express";
import type { Request, Response } from "express";
import {
  forceChangePassword,
  getAdmin,
  updateAdminProfile,
  verifyAdminCredentials,
} from "../store/admin.js";
import {
  deleteAccount,
  getAccount,
  listAccounts,
  setDefaultAccount,
  upsertAccount,
  validateAccountInput,
} from "../store/accounts.js";
import {
  checkCsrf,
  clearSessionCookie,
  requireAdminSession,
  setSessionCookie,
} from "./session.js";
import { adminHeader, esc, layout } from "../ui/html.js";

type AuthedRequest = Request & { adminEmail?: string; mustChangePassword?: boolean };

export const adminRouter = Router();

adminRouter.get("/login", (_req, res) => {
  res.type("html").send(
    layout(
      "Login",
      `<div class="narrow panel">
        <h2>Entrar no backoffice</h2>
        <form class="stack" method="post" action="/admin/login">
          <label>Email<input type="email" name="email" required autocomplete="username" /></label>
          <label>Password<input type="password" name="password" required autocomplete="current-password" /></label>
          <div class="actions"><button type="submit">Entrar</button></div>
        </form>
      </div>`
    )
  );
});

adminRouter.post("/login", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).type("html").send(layout("Erro", `<p class="error">CSRF rejeitado</p>`));
    return;
  }
  const email = String(req.body.email ?? "");
  const password = String(req.body.password ?? "");
  const admin = await verifyAdminCredentials(email, password);
  if (!admin) {
    console.log(`[oauth-shim] login fail email=${email} ip=${req.ip}`);
    res.status(401).type("html").send(
      layout("Login", `<div class="narrow panel"><p class="error">Credenciais inválidas</p>
        <p><a href="/admin/login">Tentar de novo</a></p></div>`, { error: "Credenciais inválidas" })
    );
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

adminRouter.get("/change-password", requireAdminSession, async (_req, res) => {
  res.type("html").send(
    layout(
      "Alterar password",
      `<div class="narrow panel">
        <h2>Alterar password (obrigatório)</h2>
        <p class="muted">Na primeira entrada tens de definir uma password nova (mín. 10 caracteres).</p>
        <form class="stack" method="post" action="/admin/change-password">
          <label>Nova password<input type="password" name="password" required minlength="10" autocomplete="new-password" /></label>
          <label>Confirmar<input type="password" name="password2" required minlength="10" autocomplete="new-password" /></label>
          <div class="actions"><button type="submit">Guardar</button></div>
        </form>
      </div>`
    )
  );
});

adminRouter.post("/change-password", requireAdminSession, async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const p1 = String(req.body.password ?? "");
  const p2 = String(req.body.password2 ?? "");
  if (p1 !== p2) {
    res.type("html").send(layout("Erro", `<p>As passwords não coincidem. <a href="/admin/change-password">Voltar</a></p>`, { error: "Não coincidem" }));
    return;
  }
  try {
    const admin = await forceChangePassword(p1);
    setSessionCookie(res, admin.email, admin.sessionVersion);
    res.redirect("/admin");
  } catch (err) {
    res.type("html").send(layout("Erro", `<p>${esc(err instanceof Error ? err.message : String(err))}</p>`));
  }
});

adminRouter.get("/", requireAdminSession, async (req, res) => {
  const accounts = await listAccounts();
  const flash = typeof req.query.ok === "string" ? req.query.ok : undefined;
  const rows = accounts
    .map(
      (a) => `<tr>
      <td class="mono">${esc(a.id)}${a.default ? ' <span class="badge">default</span>' : ""}</td>
      <td>${esc(a.label)}<div class="muted mono">${esc(a.mail.defaultFrom)}</div></td>
      <td class="mono">${esc(a.imap.host)}:${a.imap.port}</td>
      <td>
        <a href="/admin/accounts/${encodeURIComponent(a.id)}">Editar</a>
        ${a.default ? "" : ` · <form style="display:inline" method="post" action="/admin/accounts/${encodeURIComponent(a.id)}/default"><button class="secondary" type="submit">Default</button></form>`}
        · <form style="display:inline" method="post" action="/admin/accounts/${encodeURIComponent(a.id)}/delete" onsubmit="return confirm('Apagar conta?')"><button class="danger" type="submit">Apagar</button></form>
      </td>
    </tr>`
    )
    .join("");

  res.type("html").send(
    layout(
      "Contas",
      `${adminHeader("accounts")}
      <div class="actions" style="margin-bottom:1rem"><a class="btn" href="/admin/accounts/new">Nova conta</a></div>
      <div class="panel">
        <table>
          <thead><tr><th>ID</th><th>Label / From</th><th>IMAP</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="muted">Ainda sem contas. Adiciona a primeira.</td></tr>`}</tbody>
        </table>
      </div>`,
      { flash }
    )
  );
});

function accountForm(opts: {
  mode: "new" | "edit";
  values: Record<string, string>;
  action: string;
  error?: string;
}): string {
  const v = opts.values;
  const idReadonly = opts.mode === "edit" ? "readonly" : "";
  return `${adminHeader("accounts")}
  <h2>${opts.mode === "new" ? "Nova conta" : "Editar conta"}</h2>
  ${opts.error ? `<div class="error">${esc(opts.error)}</div>` : ""}
  <form class="stack panel" method="post" action="${esc(opts.action)}">
    <div class="row">
      <label>ID (slug)<input name="id" required pattern="[a-z0-9][a-z0-9_-]{0,31}" ${idReadonly} value="${esc(v.id ?? "")}" /></label>
      <label>Label<input name="label" required value="${esc(v.label ?? "")}" /></label>
    </div>
    <label><input type="checkbox" name="default" ${v.default === "on" || v.default === "true" ? "checked" : ""} /> Conta default</label>
    <h2>IMAP</h2>
    <div class="row">
      <label>Host<input name="imap_host" required value="${esc(v.imap_host ?? "mail.bwb.pt")}" /></label>
      <label>Porta<input name="imap_port" type="number" required value="${esc(v.imap_port ?? "993")}" /></label>
    </div>
    <div class="row">
      <label>User<input name="imap_user" required value="${esc(v.imap_user ?? "")}" /></label>
      <label>Password<input name="imap_pass" type="password" ${opts.mode === "new" ? "required" : ""} placeholder="${opts.mode === "edit" ? "deixar vazio para manter" : ""}" autocomplete="new-password" /></label>
    </div>
    <h2>SMTP</h2>
    <div class="row">
      <label>Host<input name="smtp_host" required value="${esc(v.smtp_host ?? "mail.bwb.pt")}" /></label>
      <label>Porta<input name="smtp_port" type="number" required value="${esc(v.smtp_port ?? "465")}" /></label>
    </div>
    <div class="row">
      <label>User<input name="smtp_user" required value="${esc(v.smtp_user ?? "")}" /></label>
      <label>Password<input name="smtp_pass" type="password" ${opts.mode === "new" ? "required" : ""} placeholder="${opts.mode === "edit" ? "deixar vazio para manter" : ""}" autocomplete="new-password" /></label>
    </div>
    <h2>Mail</h2>
    <div class="row">
      <label>Default From<input name="default_from" required value="${esc(v.default_from ?? "")}" /></label>
      <label>From name<input name="default_from_name" value="${esc(v.default_from_name ?? "")}" /></label>
    </div>
    <div class="row">
      <label>Drafts folder<input name="drafts_folder" value="${esc(v.drafts_folder ?? "Drafts")}" /></label>
      <label>Sent folder<input name="sent_folder" value="${esc(v.sent_folder ?? "Sent")}" /></label>
    </div>
    <h2>CalDAV (opcional)</h2>
    <label>URL<input name="caldav_url" value="${esc(v.caldav_url ?? "")}" /></label>
    <div class="row">
      <label>User<input name="caldav_user" value="${esc(v.caldav_user ?? "")}" /></label>
      <label>Password<input name="caldav_pass" type="password" placeholder="opcional" autocomplete="new-password" /></label>
    </div>
    <div class="actions">
      <button type="submit">Guardar</button>
      <a class="btn secondary" href="/admin">Cancelar</a>
    </div>
  </form>`;
}

adminRouter.get("/accounts/new", requireAdminSession, (_req, res) => {
  res.type("html").send(
    layout(
      "Nova conta",
      accountForm({
        mode: "new",
        action: "/admin/accounts/new",
        values: {
          imap_host: "mail.bwb.pt",
          imap_port: "993",
          smtp_host: "mail.bwb.pt",
          smtp_port: "465",
          drafts_folder: "Drafts",
          sent_folder: "Sent",
        },
      })
    )
  );
});

adminRouter.post("/accounts/new", requireAdminSession, async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  try {
    const account = validateAccountInput(req.body as Record<string, unknown>);
    await upsertAccount(account);
    res.redirect("/admin?ok=Conta+criada");
  } catch (err) {
    res.type("html").send(
      layout(
        "Nova conta",
        accountForm({
          mode: "new",
          action: "/admin/accounts/new",
          values: Object.fromEntries(
            Object.entries(req.body as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
          ),
          error: err instanceof Error ? err.message : String(err),
        })
      )
    );
  }
});

adminRouter.get("/accounts/:id", requireAdminSession, async (req, res) => {
  const acc = await getAccount(req.params.id);
  if (!acc) {
    res.status(404).send("Not found");
    return;
  }
  res.type("html").send(
    layout(
      "Editar conta",
      accountForm({
        mode: "edit",
        action: `/admin/accounts/${encodeURIComponent(acc.id)}`,
        values: {
          id: acc.id,
          label: acc.label,
          default: acc.default ? "true" : "",
          imap_host: acc.imap.host,
          imap_port: String(acc.imap.port),
          imap_user: acc.imap.user,
          smtp_host: acc.smtp.host,
          smtp_port: String(acc.smtp.port),
          smtp_user: acc.smtp.user,
          default_from: acc.mail.defaultFrom,
          default_from_name: acc.mail.defaultFromName ?? "",
          drafts_folder: acc.mail.draftsFolder,
          sent_folder: acc.mail.sentFolder ?? "",
          caldav_url: acc.caldav?.url ?? "",
          caldav_user: acc.caldav?.user ?? "",
        },
      })
    )
  );
});

adminRouter.post("/accounts/:id", requireAdminSession, async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  const existing = await getAccount(req.params.id);
  if (!existing) {
    res.status(404).send("Not found");
    return;
  }
  try {
    const body = { ...(req.body as Record<string, unknown>), id: existing.id };
    const account = validateAccountInput(body, { keepPass: existing });
    await upsertAccount(account);
    res.redirect("/admin?ok=Conta+atualizada");
  } catch (err) {
    res.type("html").send(
      layout(
        "Editar conta",
        accountForm({
          mode: "edit",
          action: `/admin/accounts/${encodeURIComponent(req.params.id)}`,
          values: Object.fromEntries(
            Object.entries({ ...(req.body as object), id: req.params.id }).map(([k, v]) => [
              k,
              String(v ?? ""),
            ])
          ),
          error: err instanceof Error ? err.message : String(err),
        })
      )
    );
  }
});

adminRouter.post("/accounts/:id/delete", requireAdminSession, async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  await deleteAccount(req.params.id);
  res.redirect("/admin?ok=Conta+apagada");
});

adminRouter.post("/accounts/:id/default", requireAdminSession, async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  await setDefaultAccount(req.params.id);
  res.redirect("/admin?ok=Default+atualizado");
});

adminRouter.get("/profile", requireAdminSession, async (_req, res) => {
  const admin = await getAdmin();
  res.type("html").send(
    layout(
      "Perfil",
      `${adminHeader("profile")}
      <form class="stack panel" method="post" action="/admin/profile">
        <label>Nome<input name="name" required value="${esc(admin.name)}" /></label>
        <label>Email<input name="email" type="email" required value="${esc(admin.email)}" /></label>
        <h2>Alterar password</h2>
        <p class="muted">Preenche só se quiseres mudar a password.</p>
        <label>Password actual<input name="current_password" type="password" autocomplete="current-password" /></label>
        <label>Nova password<input name="new_password" type="password" minlength="10" autocomplete="new-password" /></label>
        <div class="actions"><button type="submit">Guardar</button></div>
      </form>`
    )
  );
});

adminRouter.post("/profile", requireAdminSession, async (req: AuthedRequest, res: Response) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF");
    return;
  }
  try {
    const admin = await updateAdminProfile({
      name: String(req.body.name ?? ""),
      email: String(req.body.email ?? ""),
      currentPassword: String(req.body.current_password ?? "") || undefined,
      newPassword: String(req.body.new_password ?? "") || undefined,
    });
    setSessionCookie(res, admin.email, admin.sessionVersion);
    res.redirect("/admin?ok=Perfil+atualizado");
  } catch (err) {
    res.type("html").send(
      layout("Perfil", `${adminHeader("profile")}<p class="error">${esc(err instanceof Error ? err.message : String(err))}</p><p><a href="/admin/profile">Voltar</a></p>`)
    );
  }
});
