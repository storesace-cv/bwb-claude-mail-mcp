import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { commsConfig } from "./config.js";

export interface AdminRecord {
  name: string;
  email: string;
  passwordHash: string;
  mustChangePassword: boolean;
  sessionVersion: number;
  updatedAt: string;
}

async function readRaw(): Promise<AdminRecord | null> {
  try {
    const raw = await fs.readFile(commsConfig.adminFile, "utf8");
    return JSON.parse(raw) as AdminRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeRaw(admin: AdminRecord): Promise<void> {
  await fs.mkdir(path.dirname(commsConfig.adminFile), { recursive: true });
  const tmp = `${commsConfig.adminFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(admin, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, commsConfig.adminFile);
}

export async function ensureAdminBootstrap(opts: {
  name: string;
  email: string;
  password: string;
}): Promise<AdminRecord> {
  const existing = await readRaw();
  if (existing) return existing;
  const admin: AdminRecord = {
    name: opts.name,
    email: opts.email.toLowerCase(),
    passwordHash: await bcrypt.hash(opts.password, 12),
    mustChangePassword: true,
    sessionVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  await writeRaw(admin);
  return admin;
}

export async function getAdmin(): Promise<AdminRecord> {
  const admin = await readRaw();
  if (!admin) throw new Error("Admin not bootstrapped");
  return admin;
}

export async function verifyAdminCredentials(
  email: string,
  password: string
): Promise<AdminRecord | null> {
  const admin = await getAdmin();
  if (admin.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  const ok = await bcrypt.compare(password, admin.passwordHash);
  return ok ? admin : null;
}

export async function forceChangePassword(newPassword: string): Promise<AdminRecord> {
  if (newPassword.length < 10) throw new Error("Nova senha: mínimo 10 caracteres");
  const admin = await getAdmin();
  admin.passwordHash = await bcrypt.hash(newPassword, 12);
  admin.mustChangePassword = false;
  admin.sessionVersion += 1;
  admin.updatedAt = new Date().toISOString();
  await writeRaw(admin);
  return admin;
}
