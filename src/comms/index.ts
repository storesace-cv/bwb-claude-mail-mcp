import express from "express";
import cookieParser from "cookie-parser";
import { ensureAdminBootstrap } from "./admin-store.js";
import { commsConfig } from "./config.js";
import { getDb } from "./db.js";
import { startSchedulers } from "./jobs/run.js";
import { handleMcp } from "./mcp.js";
import { adminRouter } from "./ui/routes.js";

async function main(): Promise<void> {
  getDb();
  await ensureAdminBootstrap({
    name: process.env.BOOTSTRAP_ADMIN_NAME ?? "Jorge Peixinho",
    email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? "jorge.peixinho@bwb.pt",
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "Quer1asEntrar",
  });

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "bwb-comms" });
  });

  app.get("/", (_req, res) => {
    res.redirect("/admin");
  });

  app.post("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  app.use("/admin", adminRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "request failed",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    if (!res.headersSent) res.status(500).type("text").send("Erro interno");
  });

  process.on("unhandledRejection", (reason) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "unhandledRejection",
        error: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
      })
    );
  });

  app.listen(commsConfig.port, commsConfig.host, () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "bwb-comms listening",
        host: commsConfig.host,
        port: commsConfig.port,
        publicUrl: commsConfig.publicUrl,
      })
    );
    startSchedulers();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
