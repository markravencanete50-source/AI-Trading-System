import { extractTransactions } from "@/lib/ai/extract";
import { cfg } from "@/lib/server/config";
import { getBroker } from "@/lib/server/db";
import { handler, HttpError } from "@/lib/server/http";
import { addTxs } from "@/lib/server/ledger";

export const maxDuration = 60;

/**
 * For brokers without an API. A Make.com scenario (Gmail > Watch emails on the broker's label > HTTP POST)
 * sends each trade confirmation here. Rows land as needs_review until you confirm them on the Brokers page.
 * Headers: x-webhook-secret. Body JSON: { brokerId, messageId, subject?, text }
 */
export const POST = handler(async (req: Request) => {
  if (!cfg.webhookSecret || req.headers.get("x-webhook-secret") !== cfg.webhookSecret) throw new HttpError(401, "Bad secret");
  const body = (await req.json()) as { brokerId: string; messageId: string; subject?: string; text: string };
  const broker = await getBroker(body.brokerId);
  if (!broker) throw new HttpError(400, "Unknown broker");
  if (!body.messageId || !body.text) throw new HttpError(400, "messageId and text are required");
  const drafts = await extractTransactions(
    { kind: "text", text: `Subject: ${body.subject ?? ""}\n\n${body.text}` },
    `${broker.name}, ${broker.market} stocks, currency ${broker.currency}`,
  );
  const ids = await addTxs(drafts.map((d, i) => ({
    brokerId: broker.id, type: d.type, date: d.date, ticker: d.ticker, qty: d.qty, price: d.price, fee: d.fee,
    amount: d.amount, note: d.note, confidence: d.confidence, externalId: `${body.messageId}_${i}`,
  })), "email", "needs_review", { skipInvalid: true });
  return { added: ids.length };
});
