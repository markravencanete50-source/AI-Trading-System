import { extractTransactions } from "@/lib/ai/extract";
import { getBroker } from "@/lib/server/db";
import { handler, HttpError, readJson, requireWebhook } from "@/lib/server/http";
import { addTxs } from "@/lib/server/ledger";

export const maxDuration = 60;

/**
 * For brokers without an API. A Make.com scenario (Gmail > Watch emails on the broker's label > HTTP POST)
 * sends each trade confirmation here. Rows land as needs_review until you confirm them on the Brokers page.
 * Headers: x-webhook-secret. Body JSON: { brokerId, messageId, subject?, text }
 * A replayed messageId is ignored, so it can never undo an edit or confirmation.
 */
export const POST = handler(async (req: Request) => {
  requireWebhook(req);
  const body = await readJson<{ brokerId: string; messageId: string; subject?: string; text: string }>(req);
  if (typeof body?.brokerId !== "string" || typeof body.messageId !== "string" || typeof body.text !== "string" || !body.messageId || !body.text) {
    throw new HttpError(400, "brokerId, messageId and text are required");
  }
  if (body.text.length > 100_000) throw new HttpError(413, "Email text is too long");
  const broker = await getBroker(body.brokerId);
  if (!broker) throw new HttpError(400, "Unknown broker");
  const drafts = await extractTransactions(
    { kind: "text", text: `Subject: ${String(body.subject ?? "").slice(0, 300)}\n\n${body.text}` },
    `${broker.name}, ${broker.market} stocks, currency ${broker.currency}`,
  );
  const { ids, skipped } = await addTxs(drafts.map((d, i) => ({
    brokerId: broker.id, type: d.type, date: d.date, ticker: d.ticker, qty: d.qty, price: d.price, fee: d.fee,
    amount: d.amount, note: d.note, confidence: d.confidence, externalId: `${body.messageId}_${i}`,
  })), "email", "needs_review", { skipInvalid: true });
  return { added: ids.length, alreadyHad: skipped };
});
