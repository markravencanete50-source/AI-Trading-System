// Pure functions shared by the browser and the server. No imports with side effects.
import type { Broker, Currency, Market, Portfolio, Position, PriceDoc, Tx } from "./types";

export const priceKey = (market: Market | string, ticker: string) => `${market}_${ticker}`;

export const toPhp = (amount: number, currency: Currency, fxUsdPhp: number) =>
  currency === "USD" ? amount * fxUsdPhp : amount;

export function computePortfolio(brokers: Pick<Broker, "id" | "market">[], txs: Tx[]): Portfolio {
  const known = new Map(brokers.map((b) => [b.id, b]));
  const cash: Record<string, number> = {};
  const pos = new Map<string, Position>();
  const sorted = txs
    .filter((t) => t.status === "confirmed" && known.has(t.brokerId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  for (const t of sorted) {
    const b = known.get(t.brokerId)!;
    cash[b.id] = (cash[b.id] ?? 0) + t.amount;
    if ((t.type === "buy" || t.type === "sell") && t.ticker && t.qty) {
      const key = `${b.id}|${t.ticker}`;
      const p: Position = pos.get(key) ?? {
        brokerId: b.id, market: b.market, ticker: t.ticker, qty: 0, cost: 0, avgCost: 0, realized: 0,
      };
      if (t.type === "buy") {
        p.qty += t.qty;
        p.cost += -t.amount;
        if (t.stop) p.stop = t.stop;
        if (t.target) p.target = t.target;
      } else {
        const q = Math.min(t.qty, p.qty);
        const portion = p.qty > 0 ? p.cost * (q / p.qty) : 0;
        p.realized += t.amount - portion;
        p.qty -= q;
        p.cost -= portion;
        if (p.qty <= 1e-9) {
          p.qty = 0;
          p.cost = 0;
          delete p.stop;
          delete p.target;
        }
      }
      p.avgCost = p.qty > 0 ? p.cost / p.qty : 0;
      pos.set(key, p);
    }
  }
  for (const b of brokers) cash[b.id] ??= 0;
  return { positions: [...pos.values()], cash };
}

export interface ValuedPosition extends Position {
  currency: Currency;
  last: number;
  value: number;
  valuePhp: number;
  pnl: number;
  pnlPhp: number;
  pnlPct: number;
  weight: number;
  priced: boolean;
}

export interface Valuation {
  totalPhp: number;
  holdingsPhp: number;
  cashPhp: number;
  costPhp: number;
  byBroker: Record<string, { cashPhp: number; holdingsPhp: number; totalPhp: number }>;
  rows: ValuedPosition[];
}

export function valuation(
  pf: Portfolio, brokers: Broker[], prices: Record<string, PriceDoc>, fx: number,
): Valuation {
  const byId = new Map(brokers.map((b) => [b.id, b]));
  const rows: ValuedPosition[] = [];
  for (const p of pf.positions) {
    const b = byId.get(p.brokerId);
    if (!b || p.qty <= 0) continue;
    const pd = prices[priceKey(p.market, p.ticker)];
    const last = pd?.last ?? p.avgCost;
    const value = p.qty * last;
    rows.push({
      ...p, currency: b.currency, last, value, valuePhp: toPhp(value, b.currency, fx),
      pnl: value - p.cost, pnlPhp: toPhp(value - p.cost, b.currency, fx),
      pnlPct: p.cost > 0 ? (value / p.cost - 1) * 100 : 0, weight: 0, priced: !!pd,
    });
  }
  const byBroker: Valuation["byBroker"] = {};
  let cashPhp = 0, holdingsPhp = 0, costPhp = 0;
  for (const b of brokers) {
    const c = toPhp(pf.cash[b.id] ?? 0, b.currency, fx);
    const h = rows.filter((r) => r.brokerId === b.id).reduce((a, r) => a + r.valuePhp, 0);
    byBroker[b.id] = { cashPhp: c, holdingsPhp: h, totalPhp: c + h };
    cashPhp += c;
    holdingsPhp += h;
  }
  for (const r of rows) costPhp += toPhp(r.cost, r.currency, fx);
  const totalPhp = cashPhp + holdingsPhp;
  for (const r of rows) r.weight = totalPhp > 0 ? r.valuePhp / totalPhp : 0;
  rows.sort((a, b) => b.valuePhp - a.valuePhp);
  return { totalPhp, holdingsPhp, cashPhp, costPhp, byBroker, rows };
}

/** Bank transfers in and out, in PHP, by calendar month (YYYY-MM). */
export function flowsByMonth(txs: Tx[], months: string[]) {
  const map = new Map(months.map((m) => [m, { month: m, inPhp: 0, outPhp: 0 }]));
  for (const t of txs) {
    if (t.status !== "confirmed") continue;
    const row = map.get(t.date.slice(0, 7));
    if (!row) continue;
    const v = t.amount * (t.fxToPhp || 1);
    if (t.type === "deposit") row.inPhp += v;
    if (t.type === "withdrawal") row.outPhp += -v;
  }
  return months.map((m) => map.get(m)!);
}

export function lastMonths(n: number, from = new Date()) {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

// PSE board lots by price floor. Verify against the current PSE table.
const BOARD_LOTS: [number, number][] = [
  [0, 1_000_000], [0.01, 100_000], [0.05, 10_000], [0.5, 1_000], [5, 100], [50, 10], [1000, 5],
];
export function boardLot(price: number) {
  let lot = BOARD_LOTS[0][1];
  for (const [floor, size] of BOARD_LOTS) if (price >= floor) lot = size;
  return lot;
}

export function roundQty(market: Market, qty: number, price: number) {
  const q = Math.floor(qty);
  if (market !== "PH") return Math.max(0, q);
  const lot = boardLot(price);
  return Math.max(0, Math.floor(q / lot) * lot);
}
