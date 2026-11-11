import "server-only";
import * as alpaca from "../market/alpaca";
import { fetchUsdPhp } from "../market/fx";
import * as pse from "../market/pse";
import type { Bar } from "../market/types";
import { priceKey, valuation } from "../money";
import { col, getPrices, getSettings, listBrokers, recentSuggestions, recomputePortfolio, saveSettings } from "../server/db";
import type { Broker, Market, Outcome, Snapshot, TxType } from "../types";
import { indicators } from "./technicals";

const f2 = (n: number) => Math.round(n * 100) / 100;

export async function updateFx() {
  const rate = await fetchUsdPhp();
  if (rate) await saveSettings({ fxUsdPhp: rate, fxUpdatedAt: new Date().toISOString() });
  return rate;
}

/** Pulls fills, bank transfers, dividends and fees from Alpaca into the ledger. Idempotent by activity id. */
export async function syncAlpaca(brokers: Broker[]) {
  const targets = brokers.filter((b) => b.connection === "alpaca");
  if (!targets.length || !alpaca.alpacaConfigured()) return 0;
  const settings = await getSettings();
  let added = 0;
  for (const b of targets) {
    const after = b.lastSyncAt ? new Date(Date.parse(b.lastSyncAt) - 3 * 864e5) : new Date(Date.now() - 365 * 864e5);
    const acts = await alpaca.activities(after);
    const refs = acts.map((a) => col.txs().doc(`alpaca_${a.id.replace(/[^\w-]/g, "_")}`));
    const existing = new Set<string>();
    for (let i = 0; i < refs.length; i += 100) {
      const snaps = await col.txs().firestore.getAll(...refs.slice(i, i + 100));
      snaps.forEach((s) => s.exists && existing.add(s.id));
    }
    const writes: [FirebaseFirestore.DocumentReference, Record<string, unknown>][] = [];
    acts.forEach((a, k) => {
      if (existing.has(refs[k].id)) return;
      const date = (a.transaction_time ?? a.date ?? new Date().toISOString()).slice(0, 10);
      let type: TxType | null = null;
      let amount = Number(a.net_amount ?? 0);
      const qty = Number(a.qty ?? 0), price = Number(a.price ?? 0);
      switch (a.activity_type) {
        case "FILL": type = a.side === "buy" ? "buy" : "sell"; if (a.side === "sell_short") return; amount = (type === "buy" ? -1 : 1) * qty * price; break;
        case "CSD": type = "deposit"; break;
        case "CSW": type = "withdrawal"; break;
        case "DIV": case "DIVNRA": type = a.activity_type === "DIVNRA" ? "fee" : "dividend"; break;
        case "FEE": case "TRANS": type = "fee"; break;
        case "INT": type = "interest"; break;
      }
      if (!type || !Number.isFinite(amount) || amount === 0) return;
      writes.push([refs[k], {
        brokerId: b.id, type, date, ticker: a.symbol || undefined,
        qty: type === "buy" || type === "sell" ? qty : undefined, price: type === "buy" || type === "sell" ? price : undefined,
        amount: f2(amount), currency: b.currency, fxToPhp: b.currency === "USD" ? settings.fxUsdPhp : 1,
        note: a.description ?? `Alpaca ${a.activity_type}`, source: "alpaca", externalId: a.id, status: "confirmed",
        createdAt: new Date().toISOString(),
      }]);
      added++;
    });
    for (let i = 0; i < writes.length; i += 400) {
      const batch = col.txs().firestore.batch();
      writes.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data));
      await batch.commit();
    }
    await col.brokers().doc(b.id).update({ lastSyncAt: new Date().toISOString() });
  }
  return added;
}

async function barsFor(market: Market, tickers: string[], days: number) {
  if (!tickers.length) return {} as Record<string, Bar[]>;
  if (market === "US") return alpaca.alpacaConfigured() ? alpaca.bars(tickers, days) : {};
  return pse.bars(tickers, days);
}

/** Closing prices for everything held, so valuations are right even for tickers off the watchlist. */
export async function refreshHeldPrices(positions: { market: Market; ticker: string; qty: number }[]) {
  const batch = col.prices().firestore.batch();
  for (const m of ["PH", "US"] as Market[]) {
    const tickers = [...new Set(positions.filter((p) => p.market === m && p.qty > 0).map((p) => p.ticker))];
    const bars = await barsFor(m, tickers, 200);
    for (const t of tickers) {
      const b = bars[t];
      if (!b?.length) continue;
      const i = indicators(b);
      batch.set(col.prices().doc(priceKey(m, t)), {
        market: m, ticker: t, last: b[b.length - 1].close, prevClose: b[b.length - 2]?.close,
        ...(i ? { ema50: f2(i.ema50), rsi: f2(i.rsi), atr: f2(i.atr) } : {}), updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  }
  await batch.commit();
}

export async function writeSnapshot() {
  const [settings, brokers, prices] = await Promise.all([getSettings(), listBrokers(), getPrices()]);
  const pf = await recomputePortfolio();
  const v = valuation(pf, brokers, prices, settings.fxUsdPhp);
  const date = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Manila calendar day
  const snap: Snapshot = {
    date, totalPhp: f2(v.totalPhp), holdingsPhp: f2(v.holdingsPhp), cashPhp: f2(v.cashPhp),
    byBroker: Object.fromEntries(Object.entries(v.byBroker).map(([k, x]) => [k, f2(x.totalPhp)])), fxUsdPhp: settings.fxUsdPhp,
  };
  await col.snapshots().doc(date).set(snap);
  return snap;
}

export async function expireSuggestions() {
  const now = new Date().toISOString();
  const s = await col.suggestions().where("status", "==", "open").get();
  const batch = col.suggestions().firestore.batch();
  let n = 0;
  s.docs.forEach((d) => {
    if ((d.get("expiresAt") as string) < now) { batch.update(d.ref, { status: "expired", decidedAt: now }); n++; }
  });
  await batch.commit();
  return n;
}

const HORIZONS = [["d5", 7], ["d20", 28], ["d60", 84]] as const; // trading days approximated in calendar days
const BENCH: Record<Market, string> = { PH: "FMETF", US: "SPY" };

const closeOnOrAfter = (bars: Bar[], date: string) => bars.find((b) => b.date >= date)?.close;

/** Grades every BUY and SELL suggestion, taken or not, against the stock and a benchmark. */
export async function gradeSuggestions() {
  const all = (await recentSuggestions(100)).filter((s) => s.action === "BUY" || s.action === "SELL");
  const now = Date.now();
  const due = all.filter((s) => HORIZONS.some(([k, d]) => !s.outcome?.[k] && now >= Date.parse(s.createdAt) + d * 864e5));
  if (!due.length) return 0;
  let graded = 0;
  for (const m of ["PH", "US"] as Market[]) {
    const mine = due.filter((s) => s.market === m);
    if (!mine.length) continue;
    const bars = await barsFor(m, [...new Set([...mine.map((s) => s.ticker), BENCH[m]])], 140);
    const bench = bars[BENCH[m]] ?? [];
    for (const s of mine) {
      const b = bars[s.ticker];
      if (!b?.length) continue;
      const start = s.createdAt.slice(0, 10);
      const b0 = closeOnOrAfter(bench, start);
      const outcome: Record<string, Outcome> = { ...(s.outcome ?? {}) } as Record<string, Outcome>;
      for (const [k, d] of HORIZONS) {
        if (outcome[k] || now < Date.parse(s.createdAt) + d * 864e5) continue;
        const day = new Date(Date.parse(s.createdAt) + d * 864e5).toISOString().slice(0, 10);
        const c = closeOnOrAfter(b, day), bc = closeOnOrAfter(bench, day);
        if (!c) continue;
        outcome[k] = { ret: f2((c / s.priceAt - 1) * 100), bench: b0 && bc ? f2((bc / b0 - 1) * 100) : 0 };
      }
      await col.suggestions().doc(s.id).update({ outcome });
      graded++;
    }
  }
  return graded;
}

export async function runDaily() {
  const fx = await updateFx();
  const brokers = await listBrokers();
  const synced = await syncAlpaca(brokers).catch((e) => { console.error("Alpaca sync failed", e); return -1; });
  const pf = await recomputePortfolio();
  const step = async <T>(name: string, fn: () => Promise<T>, fallback: T) => fn().catch((e) => { console.error(`Daily step failed: ${name}`, e); return fallback; });
  await step("prices", () => refreshHeldPrices(pf.positions), undefined);
  const snapshot = await step("snapshot", writeSnapshot, null);
  const expired = await step("expire", expireSuggestions, -1);
  const graded = await step("grade", gradeSuggestions, -1);
  return { fx, synced, snapshot, expired, graded };
}
