import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { ensureAdminBootstrap } from "./store/admin.js";
import { ensureEmptyAccountsFile } from "./store/accounts.js";
import { initOAuthStore } from "./oauth/store.js";
import { adminRouter } from "./admin/routes.js";
import { oauthRouter } from "./oauth/routes.js";

async function main(): Promise<void> {
  await ensureEmptyAccountsFile();
  await initOAuthStore();
  await ensureAdminBootstrap({
    name: process.env.BOOTSTRAP_ADMIN_NAME ?? "Jorge Peixinho",
    email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? "jorge.peixinho@bwb.pt",
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "Quer1asEntrar",
  });

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "25mb" }));
  app.use(cookieParser());

  app.get("/", (_req, res) => {
    res.type("html").send(
      `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>MCP Mail</title>
      <style>
        body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;
          background:#f5f5f7;color:#1d1d1f;-webkit-font-smoothing:antialiased}
        main{text-align:center;padding:2rem}
        h1{font-size:2rem;font-weight:600;letter-spacing:-.03em;margin:0 0 .5rem}
        p{color:#86868b;margin:0 0 1.5rem}
        a{color:#1d1d1f;margin:0 .65rem;text-decoration:none;font-weight:500}
        a:hover{text-decoration:underline;text-underline-offset:3px}
      </style></head>
      <body><main>
        <h1>MCP Mail</h1>
        <p>bwb.pt</p>
        <p><a href="/admin">Backoffice</a><a href="/health">Health</a><a href="/.well-known/oauth-authorization-server">OAuth</a></p>
      </main></body></html>`
    );
  });

  // Health is proxied by nginx to upstream; keep a shim-local probe too.
  app.get("/shim-health", (_req, res) => {
    res.json({ status: "ok", service: "mcp-oauth-shim-mail" });
  });

  app.use("/admin", adminRouter);
  app.use(oauthRouter);

  app.listen(config.port, config.host, () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "mcp-oauth-shim-mail listening",
        host: config.host,
        port: config.port,
        publicUrl: config.publicUrl,
      })
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
