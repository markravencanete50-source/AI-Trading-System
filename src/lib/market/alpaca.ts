import "server-only";
import { cfg } from "../server/config";
import type { Bar, NewsItem } from "./types";

const headers = () => ({
  "APCA-API-KEY-ID": cfg.alpaca.keyId,
  "APCA-API-SECRET-KEY": cfg.alpaca.secret,
  "content-type": "application/json",
});

export const alpacaConfigured = () => !!(cfg.alpaca.keyId && cfg.alpaca.secret);
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!r.ok) throw new Error(`Alpaca ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export async function bars(symbols: string[], days = 200): Promise<Record<string, Bar[]>> {
  if (!symbols.length) return {};
  const out: Record<string, Bar[]> = {};
  let token: string | undefined;
  const start = iso(new Date(Date.now() - days * 864e5));
  do {
    const q = new URLSearchParams({
      symbols: symbols.join(","), timeframe: "1Day", start, feed: cfg.alpaca.feed, adjustment: "all", limit: "10000",
    });
    if (token) q.set("page_token", token);
    type R = { bars: Record<string, { t: string; o: number; h: number; l: number; c: number; v: number }[]> | null; next_page_token?: string };
    const j = await get<R>(`${cfg.alpaca.dataUrl}/v2/stocks/bars?${q}`);
    for (const [sym, rows] of Object.entries(j.bars ?? {})) {
      (out[sym] ??= []).push(...rows.map((b) => ({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })));
    }
    token = j.next_page_token || undefined;
  } while (token);
  return out;
}

export async function news(symbols: string[], since: Date): Promise<NewsItem[]> {
  if (!symbols.length) return [];
  const q = new URLSearchParams({ symbols: symbols.join(","), start: iso(since), limit: "50", sort: "desc", include_content: "false" });
  type R = { news: { headline: string; summary?: string; url?: string; created_at: string; symbols: string[] }[] };
  const j = await get<R>(`${cfg.alpaca.dataUrl}/v1beta1/news?${q}`);
  const wanted = new Set(symbols);
  const items: NewsItem[] = [];
  for (const n of j.news ?? []) {
    if (n.symbols.length > 6) continue; // multi-stock roundups
    for (const s of n.symbols) {
      if (!wanted.has(s)) continue;
      items.push({
        market: "US", ticker: s, headline: n.headline, summary: (n.summary ?? "").slice(0, 400),
        url: n.url ?? "", publishedAt: new Date(n.created_at).toISOString(),
      });
    }
  }
  return items;
}

export async function latestPrice(symbol: string) {
  const j = await get<{ trade: { p: number } }>(`${cfg.alpaca.dataUrl}/v2/stocks/${symbol}/trades/latest?feed=${cfg.alpaca.feed}`);
  return j.trade.p;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${cfg.alpaca.tradingUrl}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Alpaca rejected the order (${r.status}): ${await r.text()}`);
  return r.json() as Promise<T>;
}

export async function placeBuyBracket(symbol: string, qty: number, limit: number, stop: number, target: number) {
  const o = await post<{ id: string }>("/v2/orders", {
    symbol, qty: String(qty), side: "buy", type: "limit", time_in_force: "day",
    limit_price: limit.toFixed(2), order_class: "bracket",
    take_profit: { limit_price: target.toFixed(2) }, stop_loss: { stop_price: stop.toFixed(2) },
  });
  return o.id;
}

export async function placeSell(symbol: string, qty: number) {
  const o = await post<{ id: string }>("/v2/orders", {
    symbol, qty: String(qty), side: "sell", type: "market", time_in_force: "day",
  });
  return o.id;
}

export interface Activity {
  id: string;
  activity_type: string;
  transaction_time?: string;
  date?: string;
  symbol?: string;
  qty?: string;
  price?: string;
  side?: "buy" | "sell" | "sell_short";
  net_amount?: string;
  description?: string;
}

/** Fills, bank transfers, dividends and fees since a date, oldest first. */
export async function activities(after: Date): Promise<Activity[]> {
  const all: Activity[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({
      activity_types: "FILL,CSD,CSW,DIV,DIVNRA,FEE,INT,TRANS",
      after: iso(after), direction: "asc", page_size: "100",
    });
    if (pageToken) q.set("page_token", pageToken);
    const page = await get<Activity[]>(`${cfg.alpaca.tradingUrl}/v2/account/activities?${q}`);
    all.push(...page);
    if (page.length < 100) break;
    pageToken = page[page.length - 1].id;
  }
  return all;
}
