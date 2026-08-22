import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getAdmin } from "./admin-store.js";
import { commsConfig } from "./config.js";

interface SessionPayload {
  email: string;
  sessionVersion: number;
  exp: number;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", commsConfig.sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", commsConfig.sessionSecret).update(body).digest("base64url");
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
  res.cookie(commsConfig.cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(commsConfig.cookieName, { path: "/" });
}

export async function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[commsConfig.cookieName] as string | undefined;
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
    next();
  } catch {
    clearSessionCookie(res);
    res.redirect("/admin/login");
  }
}

export function checkCsrf(req: Request): boolean {
  const expected = commsConfig.publicUrl;
  const expectedHost = new URL(expected).host;
  const origin = req.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === expected;
    } catch {
      return false;
    }
  }
  const referer = req.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  const site = (req.get("sec-fetch-site") ?? "").toLowerCase();
  if (site === "same-origin" || site === "same-site") return true;
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();
  const ct = req.get("content-type") ?? "";
  if (host === expectedHost && ct.includes("application/x-www-form-urlencoded")) return true;
  return false;
}
