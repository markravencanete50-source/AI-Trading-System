import "server-only";
import { NextResponse } from "next/server";
import { cfg } from "./config";
import { adminAuth } from "./firebase";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireOwner(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "Sign in required");
  const user = await adminAuth().verifyIdToken(token).catch(() => null);
  if (!user) throw new HttpError(401, "Session expired, sign in again");
  if (!cfg.ownerEmail || !user.email_verified || user.email?.toLowerCase() !== cfg.ownerEmail) {
    throw new HttpError(403, "This account is not allowed");
  }
  return user;
}

export function requireCron(req: Request) {
  if (!cfg.cronSecret || req.headers.get("authorization") !== `Bearer ${cfg.cronSecret}`) {
    throw new HttpError(401, "Bad cron secret");
  }
}

export function handler<T>(fn: (req: Request, ctx: T) => Promise<unknown>) {
  return async (req: Request, ctx: T) => {
    try {
      const out = await fn(req, ctx);
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status >= 500) console.error(e);
      return NextResponse.json({ error: message }, { status });
    }
  };
}
