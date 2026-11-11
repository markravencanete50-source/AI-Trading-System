import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cfg } from "./config";
import { adminAuth } from "./firebase";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Constant-time string compare so secrets cannot be guessed byte by byte from response timing. */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
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
  if (!cfg.cronSecret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${cfg.cronSecret}`)) {
    throw new HttpError(401, "Bad cron secret");
  }
}

export function requireWebhook(req: Request) {
  if (!cfg.webhookSecret || !safeEqual(req.headers.get("x-webhook-secret") ?? "", cfg.webhookSecret)) {
    throw new HttpError(401, "Bad secret");
  }
}

/** Parses a JSON body, answering 400 (not 500) when it is missing or malformed. */
export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

export function handler<T>(fn: (req: Request, ctx: T) => Promise<unknown>) {
  return async (req: Request, ctx: T) => {
    try {
      const out = await fn(req, ctx);
      return NextResponse.json(out ?? { ok: true }, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e); // details stay in the server logs, never in the response
      return NextResponse.json({ error: "Something went wrong on the server. Try again." }, { status: 500 });
    }
  };
}
