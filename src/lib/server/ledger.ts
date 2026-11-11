import "server-only";
import type { Broker, Tx, TxSource, TxType } from "../types";
import { col, getSettings } from "./db";
import { HttpError } from "./http";

export const TX_TYPES: TxType[] = ["deposit", "withdrawal", "buy", "sell", "dividend", "fee", "interest"];
const STATUSES: Tx["status"][] = ["confirmed", "needs_review"];

export interface TxInput {
  brokerId: string;
  type: TxType;
  date: string;
  ticker?: string | null;
  qty?: number | null;
  price?: number | null;
  fee?: number | null;
  amount?: number | null;
  note?: string;
  stop?: number;
  target?: number;
  externalId?: string;
  confidence?: number;
}

/** Optional number: null/undefined/"" become undefined, anything else must be a finite number. */
function num(v: unknown, field: string): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  return n;
}

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false; // rejects 2026-02-31
  return s >= "1990-01-01" && s <= new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
}

export function checkStatus(s: unknown): Tx["status"] | undefined {
  if (s === undefined) return undefined;
  if (!STATUSES.includes(s as Tx["status"])) throw new HttpError(400, "status must be confirmed or needs_review");
  return s as Tx["status"];
}

/** Validates input and fills amount from qty/price/fee when it is missing. Sign follows the type. */
export function normalizeTx(input: TxInput, broker: Broker, source: TxSource, status: Tx["status"], fxUsdPhp: number): Omit<Tx, "id"> {
  if (!TX_TYPES.includes(input.type)) throw new HttpError(400, `Unknown type ${String(input.type)}`);
  if (!validDate(input.date)) throw new HttpError(400, "Date must be a real date (YYYY-MM-DD) that is not in the future");
  const trade = input.type === "buy" || input.type === "sell";
  const ticker = input.ticker ? String(input.ticker).trim().toUpperCase() : undefined;
  if (ticker && !/^[A-Z0-9.\-]{1,12}$/.test(ticker)) throw new HttpError(400, `"${ticker}" is not a valid ticker`);
  const qty = num(input.qty, "Shares"), price = num(input.price, "Price");
  const fee = Math.abs(num(input.fee, "Fees") ?? 0);
  if (trade && (!ticker || !qty || qty <= 0 || !price || price <= 0)) throw new HttpError(400, "Trades need ticker, quantity and price");

  let amount = num(input.amount, "Amount") ?? null;
  if (trade && (amount === null || amount === 0)) amount = input.type === "buy" ? -(qty! * price! + fee) : qty! * price! - fee;
  if (amount === null || !Number.isFinite(amount)) throw new HttpError(400, "Amount is required");
  if (!trade && amount === 0) throw new HttpError(400, "Amount cannot be zero");
  const negative = ["buy", "withdrawal", "fee"].includes(input.type);
  amount = negative ? -Math.abs(amount) : Math.abs(amount);

  const stop = num(input.stop, "Stop"), target = num(input.target, "Target");
  const confidence = num(input.confidence, "Confidence");
  return {
    brokerId: broker.id, type: input.type, date: input.date, ticker: trade || input.type === "dividend" ? ticker : undefined,
    qty: trade ? qty : undefined, price: trade ? price : undefined, fee: fee || undefined,
    amount: Math.round(amount * 100) / 100, currency: broker.currency,
    fxToPhp: broker.currency === "USD" ? fxUsdPhp : 1,
    note: typeof input.note === "string" ? input.note.slice(0, 300) : undefined, source,
    externalId: input.externalId ? String(input.externalId).slice(0, 200) : undefined, status,
    confidence: confidence === undefined ? undefined : Math.min(1, Math.max(0, confidence)), stop, target,
    createdAt: new Date().toISOString(),
  };
}

/** Same trade or cash movement, used to stop a re-imported statement from doubling the ledger. */
export const fingerprint = (t: Pick<Tx, "brokerId" | "date" | "type" | "ticker" | "qty" | "price" | "amount">) =>
  [t.brokerId, t.date, t.type, t.ticker ?? "", t.qty ?? "", t.price ?? "", t.amount].join("|");

export interface AddResult { ids: string[]; skipped: number }

/**
 * Writes validated rows in chunks (Firestore allows 500 writes per batch).
 * Rows with an externalId never overwrite an existing document, so a replayed email cannot
 * undo an edit or confirmation. With skipDuplicates, rows identical to an existing
 * confirmed or pending row are left out and counted.
 */
export async function addTxs(
  inputs: TxInput[], source: TxSource, status: Tx["status"],
  opts: { skipInvalid?: boolean; skipDuplicates?: boolean } = {},
): Promise<AddResult> {
  const settings = await getSettings();
  const brokers = new Map((await col.brokers().get()).docs.map((d) => [d.id, { id: d.id, ...d.data() } as Broker]));
  const db = col.txs().firestore;

  const rows: { ref: FirebaseFirestore.DocumentReference; tx: Omit<Tx, "id">; fixedId: boolean }[] = [];
  for (const input of inputs) {
    const broker = brokers.get(input.brokerId);
    if (!broker) throw new HttpError(400, `Unknown broker ${input.brokerId}`);
    try {
      const tx = normalizeTx(input, broker, source, status, settings.fxUsdPhp);
      const fixedId = !!input.externalId;
      const ref = fixedId ? col.txs().doc(`${source}_${String(input.externalId).replace(/[^\w-]/g, "_").slice(0, 120)}`) : col.txs().doc();
      rows.push({ ref, tx, fixedId });
    } catch (e) {
      if (opts.skipInvalid) { console.warn("Skipped invalid row", e); continue; }
      throw e;
    }
  }

  let skipped = 0;
  let todo = rows;
  if (rows.length) {
    const fixed = rows.filter((r) => r.fixedId);
    const existing = new Set<string>();
    for (let i = 0; i < fixed.length; i += 100) {
      const snaps = await db.getAll(...fixed.slice(i, i + 100).map((r) => r.ref));
      snaps.forEach((s) => s.exists && existing.add(s.id));
    }
    todo = rows.filter((r) => !(r.fixedId && existing.has(r.ref.id)));
    skipped += rows.length - todo.length;

    if (opts.skipDuplicates) {
      const seen = new Set((await col.txs().get()).docs.map((d) => fingerprint(d.data() as Tx)));
      const kept: typeof todo = [];
      for (const r of todo) {
        const fp = fingerprint(r.tx);
        if (seen.has(fp)) { skipped++; continue; }
        seen.add(fp); // also catches the same row twice in one upload
        kept.push(r);
      }
      todo = kept;
    }
  }

  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach((r) => batch.set(r.ref, r.tx, { merge: false }));
    await batch.commit();
  }
  return { ids: todo.map((r) => r.ref.id), skipped };
}
