import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { commsConfig } from "./config.js";
import { getDb } from "./db.js";
import { s3TenantId } from "./settings.js";

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "eu-west-1",
    endpoint: commsConfig.s3.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: commsConfig.s3.accessKey,
      secretAccessKey: commsConfig.s3.secretKey,
    },
    requestHandler: {
      requestTimeout: 25_000,
      connectionTimeout: 10_000,
    },
  });
  return client;
}

export function invoiceObjectKey(accountId: string, sha: string, filename: string): string {
  const tenant = s3TenantId();
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return `comms/${tenant}/invoices/${accountId}/${sha.slice(0, 16)}-${safe}`;
}

export function whatsappObjectKey(kind: string, sha: string, filename: string): string {
  const tenant = s3TenantId();
  const safeKind = kind.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40) || "file";
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return `comms/${tenant}/whatsapp/${safeKind}/${sha.slice(0, 16)}-${safe}`;
}

export function isS3ObjectKey(stored: string): boolean {
  return stored.startsWith("comms/");
}

export async function putAttachment(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: commsConfig.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      ACL: "private",
    })
  );
}

export async function deleteAttachment(key: string): Promise<void> {
  if (!isS3ObjectKey(key)) return;
  await s3().send(
    new DeleteObjectCommand({
      Bucket: commsConfig.s3.bucket,
      Key: key,
    })
  );
}

export async function streamAttachment(
  stored: string
): Promise<{ stream: NodeJS.ReadableStream; contentType?: string } | null> {
  if (isS3ObjectKey(stored)) {
    const out = await s3().send(
      new GetObjectCommand({
        Bucket: commsConfig.s3.bucket,
        Key: stored,
      })
    );
    if (!out.Body) return null;
    const body = out.Body;
    const stream =
      typeof (body as { pipe?: unknown }).pipe === "function"
        ? (body as NodeJS.ReadableStream)
        : Readable.from(body as AsyncIterable<Uint8Array>);
    return {
      stream,
      contentType: out.ContentType,
    };
  }
  if (existsSync(stored)) {
    return { stream: createReadStream(stored) };
  }
  return null;
}

export async function migrateLocalInvoicesToS3(): Promise<{ moved: number; skipped: number }> {
  const tenant = s3TenantId();
  if (!tenant) return { moved: 0, skipped: 0 };
  const rows = getDb()
    .prepare("SELECT id, account_id, filename, sha256, path, mime FROM invoices")
    .all() as Array<{
    id: number;
    account_id: string;
    filename: string;
    sha256: string;
    path: string;
    mime: string;
  }>;
  let moved = 0;
  let skipped = 0;
  const upd = getDb().prepare("UPDATE invoices SET path = ? WHERE id = ?");
  for (const row of rows) {
    if (isS3ObjectKey(row.path)) {
      skipped += 1;
      continue;
    }
    if (!existsSync(row.path)) {
      skipped += 1;
      continue;
    }
    const buf = await readFile(row.path);
    const key = invoiceObjectKey(row.account_id, row.sha256, row.filename);
    await putAttachment(key, buf, row.mime);
    upd.run(key, row.id);
    await unlink(row.path).catch(() => undefined);
    moved += 1;
  }
  return { moved, skipped };
}

export async function migrateLocalWhatsappAgtToS3(): Promise<{ moved: number }> {
  const tenant = s3TenantId();
  if (!tenant) return { moved: 0 };
  const dir = path.join(commsConfig.filesDir, "agt", "anexos");
  if (!existsSync(dir)) return { moved: 0 };
  const names = await readdir(dir);
  let moved = 0;
  const { createHash } = await import("node:crypto");
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    try {
      const buf = await readFile(full);
      const sha = createHash("sha256").update(buf).digest("hex");
      const key = whatsappObjectKey("agt", sha, name);
      await putAttachment(key, buf, "application/octet-stream");
      await unlink(full).catch(() => undefined);
      moved += 1;
    } catch {
      // skip unreadable
    }
  }
  return { moved };
}
