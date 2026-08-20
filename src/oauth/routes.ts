import { Router, type Request, type Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { verifyAdminCredentials } from "../store/admin.js";
import {
  consumeAuthCode,
  getClient,
  issueTokens,
  loadUpstreamBearer,
  metadata,
  registerClient,
  rotateRefreshToken,
  saveAuthCode,
  verifyAccessToken,
  verifyPkce,
  getJwks,
} from "./store.js";
import { config } from "../config.js";
import { checkCsrf } from "../admin/session.js";
import { esc, layout } from "../ui/html.js";

export const oauthRouter = Router();

oauthRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json(metadata());
});

oauthRouter.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: config.publicUrl,
    authorization_servers: [config.publicUrl],
    scopes_supported: ["mcp"],
  });
});

oauthRouter.get("/jwks.json", async (_req, res) => {
  res.json(await getJwks());
});

oauthRouter.post("/register", async (req, res) => {
  try {
    const client = await registerClient(req.body ?? {});
    res.status(201).json({
      client_id: client.client_id,
      client_secret: client.client_secret,
      client_id_issued_at: client.client_id_issued_at,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  } catch (err) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: err instanceof Error ? err.message : String(err) });
  }
});

oauthRouter.get("/authorize", async (req, res) => {
  const client_id = String(req.query.client_id ?? "");
  const redirect_uri = String(req.query.redirect_uri ?? "");
  const state = String(req.query.state ?? "");
  const code_challenge = String(req.query.code_challenge ?? "");
  const code_challenge_method = String(req.query.code_challenge_method ?? "");
  const response_type = String(req.query.response_type ?? "");

  if (response_type !== "code") {
    res.status(400).send("unsupported response_type");
    return;
  }
  if (code_challenge_method !== "S256" || !code_challenge) {
    res.status(400).send("PKCE S256 required");
    return;
  }
  const client = await getClient(client_id);
  if (!client || !client.redirect_uris.includes(redirect_uri)) {
    res.status(400).send("invalid client or redirect_uri");
    return;
  }

  res.type("html").send(
    layout(
      "Autorizar Claude",
      `<div class="narrow panel">
        <h2>Autorizar conector ${esc(config.productName)}</h2>
        <p class="muted">Inicia sessão com a conta de administrador para ligar o Claude.ai.</p>
        <form class="stack" method="post" action="/authorize">
          <input type="hidden" name="client_id" value="${esc(client_id)}" />
          <input type="hidden" name="redirect_uri" value="${esc(redirect_uri)}" />
          <input type="hidden" name="state" value="${esc(state)}" />
          <input type="hidden" name="code_challenge" value="${esc(code_challenge)}" />
          <input type="hidden" name="code_challenge_method" value="S256" />
          <label>Email<input type="email" name="email" required autocomplete="username" /></label>
          <label>Password<input type="password" name="password" required autocomplete="current-password" /></label>
          <div class="actions"><button type="submit">Autorizar</button></div>
        </form>
      </div>`
    )
  );
});

oauthRouter.post("/authorize", async (req, res) => {
  if (!checkCsrf(req)) {
    res.status(403).send("CSRF rejected");
    return;
  }
  const client_id = String(req.body.client_id ?? "");
  const redirect_uri = String(req.body.redirect_uri ?? "");
  const state = String(req.body.state ?? "");
  const code_challenge = String(req.body.code_challenge ?? "");
  const email = String(req.body.email ?? "");
  const password = String(req.body.password ?? "");

  const client = await getClient(client_id);
  if (!client || !client.redirect_uris.includes(redirect_uri)) {
    res.status(400).send("invalid client");
    return;
  }
  const admin = await verifyAdminCredentials(email, password);
  if (!admin) {
    console.log(`[oauth-shim] login fail email=${email} ip=${req.ip}`);
    res.status(401).type("html").send(layout("Erro", `<p class="error">Credenciais inválidas</p><p><a href="javascript:history.back()">Voltar</a></p>`));
    return;
  }
  if (admin.mustChangePassword) {
    res.status(403).type("html").send(
      layout(
        "Password temporária",
        `<p>Tens de alterar a password no <a href="/admin">backoffice</a> antes de autorizar o Claude.</p>`
      )
    );
    return;
  }

  const code = randomBytes(24).toString("hex");
  await saveAuthCode({
    code,
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method: "S256",
    expires_at: Date.now() + 60_000,
    admin_email: admin.email,
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

oauthRouter.post("/token", async (req, res) => {
  const grant = String(req.body.grant_type ?? "");
  try {
    if (grant === "authorization_code") {
      const code = String(req.body.code ?? "");
      const redirect_uri = String(req.body.redirect_uri ?? "");
      const code_verifier = String(req.body.code_verifier ?? "");
      const client_id = String(req.body.client_id ?? "");
      const stored = await consumeAuthCode(code);
      if (!stored || stored.client_id !== client_id || stored.redirect_uri !== redirect_uri) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      if (!verifyPkce(code_verifier, stored.code_challenge)) {
        res.status(400).json({ error: "invalid_grant", error_description: "pkce failed" });
        return;
      }
      const tokens = await issueTokens({
        client_id: stored.client_id,
        admin_email: stored.admin_email,
      });
      res.json(tokens);
      return;
    }
    if (grant === "refresh_token") {
      const refresh_token = String(req.body.refresh_token ?? "");
      const tokens = await rotateRefreshToken(refresh_token);
      if (!tokens) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      res.json(tokens);
      return;
    }
    res.status(400).json({ error: "unsupported_grant_type" });
  } catch (err) {
    res.status(500).json({ error: "server_error", error_description: err instanceof Error ? err.message : String(err) });
  }
});

async function proxyMcp(req: Request, res: Response): Promise<void> {
  const auth = req.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    res.set(
      "WWW-Authenticate",
      `Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2="${config.publicUrl}/.well-known/oauth-protected-resource"`
    );
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const verified = await verifyAccessToken(m[1]);
  if (!verified) {
    // Claude Desktop / local clients may send a shared AUTH_TOKEN directly (mail + optional WA).
    try {
      const upstream = await loadUpstreamBearer();
      const a = Buffer.from(m[1]);
      const b = Buffer.from(upstream);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(401).json({ error: "invalid_token" });
        return;
      }
    } catch {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
  }

  try {
    const upstreamPath = req.path.startsWith("/mcp") ? req.path : "/mcp";
    const upstream = new URL(upstreamPath, config.upstreamMcpUrl);
    if (req.url.includes("?")) {
      upstream.search = req.url.slice(req.url.indexOf("?"));
    }
    const headers: Record<string, string> = {
      Accept: req.get("accept") ?? "application/json, text/event-stream",
    };
    if (config.injectUpstreamBearer) {
      headers.Authorization = `Bearer ${await loadUpstreamBearer()}`;
    }
    const ct = req.get("content-type");
    if (ct) headers["Content-Type"] = ct;

    // Streamable HTTP (Python MCP) requires the client session id on every
    // request after initialize. Mail's Node MCP does not use this header.
    const forwardHeaders = [
      "mcp-session-id",
      "mcp-protocol-version",
      "last-event-id",
    ] as const;
    for (const h of forwardHeaders) {
      const v = req.get(h);
      if (v) headers[h] = v;
    }

    const init: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Notifications may arrive with an empty body; avoid sending "{}" when
      // Express left req.body undefined and the raw body was empty.
      if (req.body !== undefined && req.body !== null) {
        init.body = JSON.stringify(req.body);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      }
    }

    const upstreamRes = await fetch(upstream, init);
    res.status(upstreamRes.status);
    const passHeaders = [
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
      "cache-control",
    ];
    for (const h of passHeaders) {
      const v = upstreamRes.headers.get(h);
      if (v) res.set(h, v);
    }
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).json({
      error: "upstream_error",
      error_description: err instanceof Error ? err.message : String(err),
    });
  }
}

oauthRouter.all("/mcp", proxyMcp);
oauthRouter.all("/mcp/*", proxyMcp);
