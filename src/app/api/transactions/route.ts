import { col, getBroker, getSettings, recomputePortfolio } from "@/lib/server/db";
import { handler, HttpError, requireOwner } from "@/lib/server/http";
import { addTxs, normalizeTx, type TxInput } from "@/lib/server/ledger";
import type { Tx } from "@/lib/types";

/** Create one or many confirmed transactions. Body: TxInput | TxInput[] */
export const POST = handler(async (req: Request) => {
  await requireOwner(req);
  const body = await req.json();
  const list: TxInput[] = Array.isArray(body) ? body : [body];
  if (!list.length || list.length > 500) throw new HttpError(400, "Send 1 to 500 transactions");
  const ids = await addTxs(list, list.length > 1 ? "import" : "manual", "confirmed");
  await recomputePortfolio();
  return { ids };
});

/** Edit and/or confirm a transaction (used by the review queue). Body: { id, ...TxInput, status? } */
export const PATCH = handler(async (req: Request) => {
  await requireOwner(req);
  const body = (await req.json()) as TxInput & { id: string; status?: Tx["status"] };
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
  const tx = normalizeTx(merged, broker, old.source, body.status ?? old.status, old.fxToPhp || settings.fxUsdPhp);
  await ref.set({ ...tx, createdAt: old.createdAt });
  await recomputePortfolio();
  return { id: body.id };
});

export const DELETE = handler(async (req: Request) => {
  await requireOwner(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  await col.txs().doc(id).delete();
  await recomputePortfolio();
  return { id };
});
