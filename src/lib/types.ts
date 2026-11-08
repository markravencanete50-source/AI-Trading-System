export type Market = "PH" | "US";
export type Currency = "PHP" | "USD";
export type Connection = "alpaca" | "email" | "manual";
export type TxType = "deposit" | "withdrawal" | "buy" | "sell" | "dividend" | "fee" | "interest";
export type TxSource = "manual" | "import" | "email" | "alpaca" | "suggestion";
export type Action = "BUY" | "SELL" | "TRIM" | "WATCH";
export type SuggestionStatus = "open" | "done" | "dismissed" | "expired";

export interface Broker {
  id: string;
  name: string;
  market: Market;
  currency: Currency;
  connection: Connection;
  createdAt: string;
  lastSyncAt?: string;
}

/** amount = signed cash effect on the broker account, in the broker's currency.
 *  Buys are negative (gross + fees), sells positive (net of fees), deposits positive, withdrawals negative. */
export interface Tx {
  id: string;
  brokerId: string;
  type: TxType;
  date: string; // YYYY-MM-DD
  ticker?: string;
  qty?: number;
  price?: number;
  fee?: number;
  amount: number;
  currency: Currency;
  fxToPhp: number; // PHP per unit of currency on the transaction date (1 for PHP)
  note?: string;
  source: TxSource;
  externalId?: string;
  status: "confirmed" | "needs_review";
  confidence?: number;
  stop?: number; // set on buys that came from a suggestion plan
  target?: number;
  createdAt: string;
}

export interface Position {
  brokerId: string;
  market: Market;
  ticker: string;
  qty: number;
  cost: number; // remaining cost basis incl. fees, broker currency
  avgCost: number;
  realized: number;
  stop?: number;
  target?: number;
}

export interface Portfolio {
  positions: Position[];
  cash: Record<string, number>; // brokerId -> cash in broker currency
  updatedAt?: string;
}

export interface PriceDoc {
  market: Market;
  ticker: string;
  name?: string;
  last: number;
  prevClose?: number;
  ema50?: number;
  rsi?: number;
  atr?: number;
  updatedAt: string;
}

export interface Plan {
  qty: number;
  entry: number;
  stop?: number;
  target?: number;
  cashNeeded?: number;
}

export interface Outcome {
  ret: number; // % move of the stock from priceAt to the horizon
  bench: number; // % move of the benchmark over the same window
}

export interface Suggestion {
  id: string;
  market: Market;
  ticker: string;
  brokerId: string | null;
  action: Action;
  headline: string;
  reasons: string[];
  news: { headline: string; url: string; impact: number }[];
  plan?: Plan;
  priceAt: number;
  newsScore: number;
  status: SuggestionStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  orderId?: string;
  outcome?: Partial<Record<"d5" | "d20" | "d60", Outcome>>;
}

export interface Snapshot {
  date: string;
  totalPhp: number;
  holdingsPhp: number;
  cashPhp: number;
  byBroker: Record<string, number>;
  fxUsdPhp: number;
}

export interface Settings {
  watchlist: { US: string[]; PH: Record<string, string[]> };
  phFeeds: string[];
  riskPerTrade: number;
  maxPositionPct: number;
  newsThreshold: number;
  newsHalfLifeH: number;
  cooldownH: number;
  buyTtlH: number;
  maxSlippagePct: number;
  maxScoredPerDay: number;
  defaultBroker: { PH: string | null; US: string | null };
  fxUsdPhp: number;
  fxUpdatedAt: string | null;
  alertEmail: string;
}
