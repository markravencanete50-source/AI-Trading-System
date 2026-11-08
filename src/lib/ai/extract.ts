import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { TxType } from "../types";
import { cfg } from "../server/config";
import { anthropic, parseJson, textOf } from "./client";

const TYPES: TxType[] = ["deposit", "withdrawal", "buy", "sell", "dividend", "fee", "interest"];

const SYSTEM = `You extract brokerage transactions from trade confirmation emails, account statements, CSV exports, screenshots or pasted text.

Return ONLY JSON, no prose, no code fences:
{"transactions":[{"type":"buy|sell|deposit|withdrawal|dividend|fee|interest","date":"YYYY-MM-DD","ticker":string|null,"qty":number|null,"price":number|null,"fee":number|null,"amount":number,"note":string,"confidence":number}]}

Rules:
- amount is the signed cash effect on the brokerage account in the account currency: negative for buys (gross plus every fee and tax), positive for sells (net of fees and taxes), positive for deposits, dividends and interest, negative for withdrawals and standalone fees.
- fee is the total of commissions, VAT, exchange and clearing fees and sales tax for that trade.
- Use the exchange ticker symbol (PSE symbols like JFC, BDO, ALI for Philippine stocks).
- One object per trade or cash movement. Ignore balances, running totals, portfolio summaries and anything that is not a transaction.
- Never invent values. If a field is unreadable, set it to null and lower confidence. confidence is 0 to 1 for the whole row.
- If the document contains no transactions, return {"transactions":[]}.`;

export interface Draft {
  type: TxType;
  date: string;
  ticker: string | null;
  qty: number | null;
  price: number | null;
  fee: number | null;
  amount: number;
  note: string;
  confidence: number;
}

export type ExtractInput =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "image"; base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" };

export async function extractTransactions(input: ExtractInput, hint: string): Promise<Draft[]> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.kind === "text") content.push({ type: "text", text: input.text.slice(0, 60000) });
  if (input.kind === "pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } });
  if (input.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } });
  content.push({ type: "text", text: `Account context: ${hint}. Today is ${new Date().toISOString().slice(0, 10)}.` });

  const msg = await anthropic().messages.create({ model: cfg.aiModel, max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content }] });
  const out = parseJson<{ transactions: Record<string, unknown>[] }>(textOf(msg), "{");
  const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return (out.transactions ?? [])
    .filter((t) => TYPES.includes(t.type as TxType) && Number.isFinite(Number(t.amount)))
    .map((t) => ({
      type: t.type as TxType,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) ? String(t.date) : new Date().toISOString().slice(0, 10),
      ticker: t.ticker ? String(t.ticker).toUpperCase() : null,
      qty: num(t.qty), price: num(t.price), fee: num(t.fee),
      amount: Number(t.amount), note: String(t.note ?? "").slice(0, 200),
      confidence: Math.min(1, Math.max(0, Number(t.confidence ?? 0.5))),
    }));
}
