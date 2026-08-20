import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config } from "../config.js";

export interface AdminRecord {
  name: string;
  email: string;
  passwordHash: string;
  mustChangePassword: boolean;
  sessionVersion: number;
  updatedAt: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readRaw(): Promise<AdminRecord | null> {
  try {
    const raw = await fs.readFile(config.adminFile, "utf8");
    return JSON.parse(raw) as AdminRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeRaw(admin: AdminRecord): Promise<void> {
  await fs.mkdir(path.dirname(config.adminFile), { recursive: true });
  const tmp = `${config.adminFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(admin, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, config.adminFile);
  await fs.chmod(config.adminFile, 0o600);
}

export async function ensureAdminBootstrap(opts: {
  name: string;
  email: string;
  password: string;
}): Promise<AdminRecord> {
  const existing = await readRaw();
  if (existing) return existing;
  const passwordHash = await bcrypt.hash(opts.password, 12);
  const admin: AdminRecord = {
    name: opts.name,
    email: opts.email.toLowerCase(),
    passwordHash,
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

export async function updateAdminProfile(input: {
  name?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<AdminRecord> {
  const admin = await getAdmin();

  if (input.newPassword) {
    if (!input.currentPassword) throw new Error("Current password required");
    const ok = await bcrypt.compare(input.currentPassword, admin.passwordHash);
    if (!ok) throw new Error("Current password is incorrect");
    if (input.newPassword.length < 10) throw new Error("New password must be at least 10 characters");
    admin.passwordHash = await bcrypt.hash(input.newPassword, 12);
    admin.mustChangePassword = false;
    admin.sessionVersion += 1;
  }

  if (typeof input.name === "string" && input.name.trim()) {
    admin.name = input.name.trim();
  }

  if (typeof input.email === "string" && input.email.trim()) {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Invalid email");
    admin.email = email;
    admin.sessionVersion += 1;
  }

  admin.updatedAt = new Date().toISOString();
  await writeRaw(admin);
  return admin;
}

export async function forceChangePassword(newPassword: string): Promise<AdminRecord> {
  if (newPassword.length < 10) throw new Error("New password must be at least 10 characters");
  const admin = await getAdmin();
  admin.passwordHash = await bcrypt.hash(newPassword, 12);
  admin.mustChangePassword = false;
  admin.sessionVersion += 1;
  admin.updatedAt = new Date().toISOString();
  await writeRaw(admin);
  return admin;
}
