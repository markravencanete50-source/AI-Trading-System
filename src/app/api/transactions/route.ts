import { col, getBroker, getSettings, recomputePortfolio } from "@/lib/server/db";
import { handler, HttpError, readJson, requireOwner } from "@/lib/server/http";
import { addTxs, checkStatus, normalizeTx, type TxInput } from "@/lib/server/ledger";
import type { Tx } from "@/lib/types";

/** Create one or many confirmed transactions. Body: TxInput | TxInput[]. Bulk uploads skip rows already in the ledger. */
export const POST = handler(async (req: Request) => {
  await requireOwner(req);
  const body = await readJson<TxInput | TxInput[]>(req);
  const list: TxInput[] = Array.isArray(body) ? body : [body];
  if (!list.length || list.length > 500) throw new HttpError(400, "Send 1 to 500 transactions");
  if (list.some((t) => !t || typeof t !== "object")) throw new HttpError(400, "Each transaction must be an object");
  // An array body is an import (even of one row): rows already in the ledger are left out.
  const imported = Array.isArray(body);
  const { ids, skipped } = await addTxs(list, imported ? "import" : "manual", "confirmed", { skipDuplicates: imported });
  await recomputePortfolio();
  return { ids, skipped };
});

/** Edit and/or confirm a transaction (used by the review queue). Body: { id, ...TxInput, status? } */
export const PATCH = handler(async (req: Request) => {
  await requireOwner(req);
  const body = await readJson<TxInput & { id: string; status?: Tx["status"] }>(req);
  if (!body?.id || typeof body.id !== "string") throw new HttpError(400, "id required");
  const status = checkStatus(body.status);
  const ref = col.txs().doc(body.id);
  const cur = await ref.get();
  if (!cur.exists) throw new HttpError(404, "Transaction not found");
  const old = cur.data() as Tx;
  const broker = await getBroker(body.brokerId ?? old.brokerId);
  if (!broker) throw new HttpError(400, "Unknown broker");
  const settings = await getSettings();
  const merged: TxInput = {
    brokerId: broker.id, type: body.type ?? old.type, date: body.date ?? old.date,
    ticker: body.ticker !== undefined ? body.ticker : old.ticker, qty: body.qty !== undefined ? body.qty : old.qty,
    price: body.price !== undefined ? body.price : old.price, fee: body.fee !== undefined ? body.fee : old.fee,
    amount: body.amount !== undefined ? body.amount : old.amount, note: body.note ?? old.note,
    stop: old.stop, target: old.target, externalId: old.externalId, confidence: old.confidence,
  };
  const tx = normalizeTx(merged, broker, old.source, status ?? old.status, old.fxToPhp || settings.fxUsdPhp);
  await ref.set({ ...tx, createdAt: old.createdAt });
  await recomputePortfolio();
  return { id: body.id };
});

export const DELETE = handler(async (req: Request) => {
  await requireOwner(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  const ref = col.txs().doc(id);
  if (!(await ref.get()).exists) throw new HttpError(404, "Transaction not found");
  await ref.delete();
  await recomputePortfolio();
  return { id };
});
