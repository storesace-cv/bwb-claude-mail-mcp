import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { commsConfig } from "./config.js";
import { getDb } from "./db.js";

interface JsonRpc {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "unanswered_list",
    description: "Lista threads de email sem resposta (read-only).",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "invoices_list",
    description: "Lista facturas extraídas dos anexos (read-only).",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "kb_drafts",
    description: "Lista drafts da base de conhecimento (read-only).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_extract",
    description: "Obtém texto extraído de uma factura ou item KB.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["invoice", "kb"] },
        id: { type: "number" },
      },
      required: ["kind", "id"],
    },
  },
];

function bearerOk(req: Request): boolean {
  const token = commsConfig.authToken;
  if (!token) return false;
  const header = req.get("authorization") ?? "";
  const got = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: unknown, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message } };
}

function callTool(name: string, params: Record<string, unknown> | undefined): unknown {
  const db = getDb();
  const limit = Math.min(Number(params?.limit ?? 30) || 30, 80);
  if (name === "unanswered_list") {
    return db
      .prepare(
        `SELECT account_id, subject, last_inbound_at FROM mail_threads
         WHERE unanswered = 1 ORDER BY last_inbound_at DESC LIMIT ?`
      )
      .all(limit);
  }
  if (name === "invoices_list") {
    return db
      .prepare(
        `SELECT id, filename, mime, substr(extracted_text,1,500) AS extract
         FROM invoices ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit);
  }
  if (name === "kb_drafts") {
    return db
      .prepare(
        `SELECT id, title, problem, solution, tags, status FROM kb_items
         WHERE status = 'draft' ORDER BY created_at DESC LIMIT 50`
      )
      .all();
  }
  if (name === "get_extract") {
    const kind = String(params?.kind ?? "");
    const id = Number(params?.id);
    if (kind === "invoice") {
      return db
        .prepare("SELECT id, filename, extracted_text FROM invoices WHERE id = ?")
        .get(id);
    }
    if (kind === "kb") {
      return db.prepare("SELECT id, title, problem, solution FROM kb_items WHERE id = ?").get(id);
    }
    throw new Error("kind inválido");
  }
  throw new Error(`tool desconhecida: ${name}`);
}

export async function handleMcp(req: Request, res: Response): Promise<void> {
  if (!bearerOk(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body as JsonRpc;
  const method = body?.method ?? "";
  const id = body?.id;

  if (method === "initialize" || method === "ping") {
    res.json(
      rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "bwb-comms", version: "1.0.0" },
      })
    );
    return;
  }
  if (method === "notifications/initialized") {
    res.status(202).end();
    return;
  }
  if (method === "tools/list") {
    res.json(rpcResult(id, { tools: TOOLS }));
    return;
  }
  if (method === "tools/call") {
    try {
      const name = String(body.params?.name ?? "");
      const args = (body.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const data = callTool(name, args);
      res.json(
        rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        })
      );
    } catch (err) {
      res.json(rpcError(id, err instanceof Error ? err.message : String(err)));
    }
    return;
  }
  res.json(rpcError(id, `método não suportado: ${method}`));
}
