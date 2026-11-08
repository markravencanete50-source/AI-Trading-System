import "server-only";
import type { Broker, Tx, TxSource, TxType } from "../types";
import { col, getSettings } from "./db";
import { HttpError } from "./http";

const TYPES: TxType[] = ["deposit", "withdrawal", "buy", "sell", "dividend", "fee", "interest"];

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

/** Validates input and fills amount from qty/price/fee when it is missing. Sign follows the type. */
export function normalizeTx(input: TxInput, broker: Broker, source: TxSource, status: Tx["status"], fxUsdPhp: number): Omit<Tx, "id"> {
  if (!TYPES.includes(input.type)) throw new HttpError(400, `Unknown type ${input.type}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw new HttpError(400, "Date must be YYYY-MM-DD");
  const trade = input.type === "buy" || input.type === "sell";
  const ticker = input.ticker ? String(input.ticker).trim().toUpperCase() : undefined;
  const qty = input.qty ?? undefined, price = input.price ?? undefined, fee = Math.abs(input.fee ?? 0);
  if (trade && (!ticker || !qty || qty <= 0 || !price || price <= 0)) throw new HttpError(400, "Trades need ticker, quantity and price");

  let amount = input.amount ?? null;
  if (trade && (amount === null || amount === 0)) amount = input.type === "buy" ? -(qty! * price! + fee) : qty! * price! - fee;
  if (amount === null || !Number.isFinite(amount)) throw new HttpError(400, "Amount is required");
  const negative = ["buy", "withdrawal", "fee"].includes(input.type);
  amount = negative ? -Math.abs(amount) : Math.abs(amount);

  return {
    brokerId: broker.id, type: input.type, date: input.date, ticker: trade || input.type === "dividend" ? ticker : undefined,
    qty: trade ? qty : undefined, price: trade ? price : undefined, fee: fee || undefined,
    amount: Math.round(amount * 100) / 100, currency: broker.currency,
    fxToPhp: broker.currency === "USD" ? fxUsdPhp : 1,
    note: input.note?.slice(0, 300), source, externalId: input.externalId, status,
    confidence: input.confidence, stop: input.stop, target: input.target,
    createdAt: new Date().toISOString(),
  };
}

export async function addTxs(inputs: TxInput[], source: TxSource, status: Tx["status"], opts: { skipInvalid?: boolean } = {}) {
  const settings = await getSettings();
  const brokers = new Map((await col.brokers().get()).docs.map((d) => [d.id, { id: d.id, ...d.data() } as Broker]));
  const batch = col.txs().firestore.batch();
  const ids: string[] = [];
  for (const input of inputs) {
    const broker = brokers.get(input.brokerId);
    if (!broker) throw new HttpError(400, `Unknown broker ${input.brokerId}`);
    let tx: Omit<Tx, "id">;
    try {
      tx = normalizeTx(input, broker, source, status, settings.fxUsdPhp);
    } catch (e) {
      if (opts.skipInvalid) { console.warn("Skipped invalid row", input, e); continue; }
      throw e;
    }
    const ref = input.externalId ? col.txs().doc(`${source}_${input.externalId.replace(/[^\w-]/g, "_").slice(0, 120)}`) : col.txs().doc();
    batch.set(ref, tx, { merge: false });
    ids.push(ref.id);
  }
  await batch.commit();
  return ids;
}
