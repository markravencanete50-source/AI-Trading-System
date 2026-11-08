import * as alpaca from "@/lib/market/alpaca";
import { col, getBroker, getSettings, getSuggestion, recomputePortfolio } from "@/lib/server/db";
import { handler, HttpError, requireOwner } from "@/lib/server/http";
import { addTxs } from "@/lib/server/ledger";

type Ctx = { params: Promise<{ id: string }> };
type Body = {
  do: "execute" | "done" | "dismiss";
  fill?: { qty: number; price: number; fee?: number; date: string };
};

export const POST = handler(async (req: Request, { params }: Ctx) => {
  await requireOwner(req);
  const { id } = await params;
  const body = (await req.json()) as Body;
  const s = await getSuggestion(id);
  if (!s) throw new HttpError(404, "Suggestion not found");
  if (s.status !== "open") throw new HttpError(409, `Already ${s.status}`);
  const ref = col.suggestions().doc(id);
  const decidedAt = new Date().toISOString();

  if (body.do === "dismiss") {
    await ref.update({ status: "dismissed", decidedAt });
    return { status: "dismissed" };
  }

  // Claim first so a double tap cannot act twice.
  const claimed = await col.suggestions().firestore.runTransaction(async (t) => {
    const cur = await t.get(ref);
    if (cur.get("status") !== "open") return false;
    t.update(ref, { status: "done", decidedAt });
    return true;
  });
  if (!claimed) throw new HttpError(409, "Already handled");

  try {
    if (body.do === "execute") {
      const broker = s.brokerId ? await getBroker(s.brokerId) : null;
      if (broker?.connection !== "alpaca") throw new HttpError(400, "This broker has no API. Place it yourself and log it.");
      if (!s.plan) throw new HttpError(400, "No plan on this suggestion");
      const settings = await getSettings();
      let orderId: string;
      if (s.action === "BUY") {
        const live = await alpaca.latestPrice(s.ticker);
        if (live > s.plan.entry * (1 + settings.maxSlippagePct)) {
          throw new HttpError(409, `Price ran to ${live.toFixed(2)}, more than ${(settings.maxSlippagePct * 100).toFixed(1)}% above entry. Skipped.`);
        }
        if (s.plan.stop && live <= s.plan.stop) throw new HttpError(409, "Price is already under the stop. Skipped.");
        orderId = await alpaca.placeBuyBracket(s.ticker, s.plan.qty, s.plan.entry, s.plan.stop!, s.plan.target!);
      } else if (s.action === "SELL" || s.action === "TRIM") {
        orderId = await alpaca.placeSell(s.ticker, s.plan.qty);
      } else {
        throw new HttpError(400, "Nothing to execute for WATCH");
      }
      await ref.update({ orderId });
      return { status: "done", orderId, note: "The fill reaches the ledger on the next Alpaca sync." };
    }

    if (body.do === "done") {
      if (s.action === "WATCH") return { status: "done" };
      if (!s.brokerId) throw new HttpError(400, "Pick a default broker for this market in Settings first");
      const f = body.fill;
      if (!f || !f.qty || !f.price || !f.date) throw new HttpError(400, "Enter the quantity, price and date you got");
      await addTxs([{
        brokerId: s.brokerId, type: s.action === "BUY" ? "buy" : "sell", date: f.date, ticker: s.ticker,
        qty: f.qty, price: f.price, fee: f.fee ?? 0, note: `From suggestion ${s.action} ${s.ticker}`,
        stop: s.action === "BUY" ? s.plan?.stop : undefined, target: s.action === "BUY" ? s.plan?.target : undefined,
      }], "suggestion", "confirmed");
      await recomputePortfolio();
      return { status: "done" };
    }
    throw new HttpError(400, "Unknown action");
  } catch (e) {
    await ref.update({ status: "open", decidedAt: null }); // release the claim
    throw e;
  }
});
