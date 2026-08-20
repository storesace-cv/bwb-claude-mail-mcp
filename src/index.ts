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
      `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>MCP Mail</title></head>
      <body style="font-family:system-ui;background:#0f1419;color:#e8eef4;padding:2rem">
      <h1>MCP Mail · bwb.pt</h1>
      <p><a href="/admin" style="color:#3d8bfd">Backoffice</a> ·
      <a href="/health" style="color:#3d8bfd">Health</a> ·
      <a href="/.well-known/oauth-authorization-server" style="color:#3d8bfd">OAuth metadata</a></p>
      </body></html>`
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
