import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { getAdmin } from "../store/admin.js";

export interface SessionPayload {
  email: string;
  sessionVersion: number;
  exp: number;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, email: string, sessionVersion: number): void {
  const token = sign({
    email,
    sessionVersion,
    exp: Date.now() + 12 * 3600 * 1000,
  });
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.cookieName, { path: "/" });
}

export async function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[config.cookieName] as string | undefined;
  if (!token) {
    res.redirect("/admin/login");
    return;
  }
  const payload = verify(token);
  if (!payload) {
    clearSessionCookie(res);
    res.redirect("/admin/login");
    return;
  }
  try {
    const admin = await getAdmin();
    if (admin.email !== payload.email || admin.sessionVersion !== payload.sessionVersion) {
      clearSessionCookie(res);
      res.redirect("/admin/login");
      return;
    }
    (req as Request & { adminEmail: string; mustChangePassword: boolean }).adminEmail = admin.email;
    (req as Request & { mustChangePassword: boolean }).mustChangePassword = admin.mustChangePassword;
    if (admin.mustChangePassword && !req.path.startsWith("/admin/change-password")) {
      res.redirect("/admin/change-password");
      return;
    }
    next();
  } catch {
    clearSessionCookie(res);
    res.redirect("/admin/login");
  }
}

export function checkCsrf(req: Request): boolean {
  const origin = req.get("origin");
  const referer = req.get("referer");
  const expected = config.publicUrl;
  if (origin) return origin === expected;
  if (referer) return referer.startsWith(expected + "/") || referer === expected;
  return false;
}
