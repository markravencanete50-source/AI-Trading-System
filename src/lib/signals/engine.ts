import "server-only";
import { scoreAndStore, recentNews, type ScoredNews } from "../ai/scorer";
import * as alpaca from "../market/alpaca";
import * as pse from "../market/pse";
import { phNews } from "../market/rss";
import type { Bar, NewsItem } from "../market/types";
import { priceKey, roundQty, toPhp, valuation } from "../money";
import { col, getPortfolio, getPrices, getSettings, listBrokers, recentSuggestions } from "../server/db";
import { emailSuggestions } from "../server/notify";
import type { Action, Market, PriceDoc, Settings, Suggestion } from "../types";
import { indicators, type Indicators } from "./technicals";

const f2 = (n: number) => Math.round(n * 100) / 100;

export function newsScore(rows: ScoredNews[], ticker: string, halfLifeH: number, now = Date.now()) {
  let total = 0;
  const contrib: { headline: string; url: string; impact: number }[] = [];
  for (const r of rows) {
    if (r.ticker !== ticker || r.magnitude < 2) continue;
    const ageH = Math.max(0, (now - Date.parse(r.publishedAt)) / 3600e3);
    const w = 0.5 ** (ageH / halfLifeH) * (r.novelty === "new" ? 1 : 0.3);
    const v = r.direction * r.magnitude * r.confidence * w;
    total += v;
    contrib.push({ headline: r.headline, url: r.url, impact: f2(v) });
  }
  contrib.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return { score: f2(total), top: contrib.slice(0, 3) };
}

type Draft = Omit<Suggestion, "id">;

export async function runScan(market: Market) {
  const [settings, portfolio, brokers, prices] = await Promise.all([getSettings(), getPortfolio(), listBrokers(), getPrices()]);
  const fx = settings.fxUsdPhp;
  const marketBrokers = brokers.filter((b) => b.market === market);
  const held = portfolio.positions.filter((p) => p.market === market && p.qty > 0);
  const watch = market === "US" ? settings.watchlist.US : Object.keys(settings.watchlist.PH);
  const universe = [...new Set([...watch, ...held.map((h) => h.ticker)])];
  if (!universe.length) return { market, universe: 0, scored: 0, created: 0 };

  // 1. Prices and news
  const now = new Date();
  let bars: Record<string, Bar[]>;
  let items: NewsItem[];
  if (market === "US") {
    if (!alpaca.alpacaConfigured()) throw new Error("US scans need ALPACA_KEY_ID and ALPACA_SECRET_KEY for market data");
    [bars, items] = await Promise.all([alpaca.bars(universe), alpaca.news(universe, new Date(now.getTime() - 6 * 3600e3))]);
  } else {
    bars = await pse.bars(universe);
    const aliases: Record<string, string[]> = { ...settings.watchlist.PH };
    for (const t of universe) {
      if (aliases[t]?.length) continue;
      const ids = await pse.ids(t).catch(() => null);
      if (ids) aliases[t] = [ids.name.replace(/,?\s+(Corporation|Corp\.?|Inc\.?|Holdings|Company)\b.*$/i, "")];
    }
    const [rss, disc] = await Promise.all([
      phNews(aliases, settings.phFeeds, new Date(now.getTime() - 24 * 3600e3)),
      pse.disclosures(universe, new Date(now.getTime() - 48 * 3600e3)),
    ]);
    items = [...rss, ...disc];
  }
  const scored = await scoreAndStore(items, settings.maxScoredPerDay);
  const news = await recentNews(market);

  // 2. Indicators, saved as the latest price for the dashboard
  const ind: Record<string, Indicators> = {};
  const batch = col.prices().firestore.batch();
  for (const t of universe) {
    const i = indicators(bars[t] ?? []);
    if (!i) continue;
    ind[t] = i;
    const doc: PriceDoc = { market, ticker: t, last: i.last, prevClose: i.prevClose, ema50: f2(i.ema50), rsi: f2(i.rsi), atr: f2(i.atr), updatedAt: now.toISOString() };
    batch.set(col.prices().doc(priceKey(market, t)), doc, { merge: true });
    prices[priceKey(market, t)] = doc;
  }
  await batch.commit();

  // 3. Rules
  const val = valuation(portfolio, brokers, prices, fx);
  const recent = await recentSuggestions(Math.max(3, settings.cooldownH / 24 + 1));
  const blocked = (ticker: string, action: Action, brokerId: string | null) =>
    recent.some((s) => s.ticker === ticker && s.market === market && s.action === action && (s.brokerId ?? null) === brokerId &&
      (s.status === "open" || Date.parse(s.createdAt) > now.getTime() - settings.cooldownH * 3600e3));

  const drafts: Draft[] = [];
  const base = (ticker: string, action: Action, brokerId: string | null, headline: string, reasons: string[], priceAt: number, ns: ReturnType<typeof newsScore>, ttlH: number): Draft => ({
    market, ticker, brokerId, action, headline, reasons, news: ns.top, priceAt, newsScore: ns.score, status: "open",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlH * 3600e3).toISOString(),
  });

  for (const t of universe) {
    const i = ind[t];
    if (!i) continue;
    const ns = newsScore(news, t, settings.newsHalfLifeH);
    const positions = held.filter((p) => p.ticker === t);

    for (const p of positions) {
      const b = brokers.find((x) => x.id === p.brokerId)!;
      const row = val.rows.find((r) => r.brokerId === p.brokerId && r.ticker === t);
      const stop = p.stop ?? p.avgCost - 2 * i.atr;
      if (i.last < stop && !blocked(t, "SELL", p.brokerId)) {
        drafts.push({ ...base(t, "SELL", p.brokerId, `${t} closed below your stop`, [
          `Last ${i.last.toFixed(2)} is under the stop of ${stop.toFixed(2)}${p.stop ? " set when you bought" : " (2x ATR under your average cost)"}`,
          i.last < i.ema50 ? "Price is also under its 50-day average" : "Price is still above its 50-day average, so the trend is not fully broken",
          ns.score ? `News score ${ns.score}` : "No significant news in the last 3 days",
        ], i.last, ns, 72), plan: { qty: p.qty, entry: i.last } });
        continue;
      }
      if (row && row.weight > settings.maxPositionPct && !blocked(t, "TRIM", p.brokerId)) {
        const targetPhp = settings.maxPositionPct * 0.95 * val.totalPhp;
        const excess = toPhp(1, b.currency, fx);
        const sellQty = roundQty(market, (row.valuePhp - targetPhp) / (excess * i.last), i.last);
        if (sellQty > 0) {
          drafts.push({ ...base(t, "TRIM", p.brokerId, `${t} has grown past your position limit`, [
            `It is ${(row.weight * 100).toFixed(0)}% of your portfolio and your limit is ${(settings.maxPositionPct * 100).toFixed(0)}%`,
            `Selling ${sellQty} brings it back to about ${(settings.maxPositionPct * 95).toFixed(0)}%`,
          ], i.last, ns, 72), plan: { qty: sellQty, entry: i.last } });
          continue;
        }
      }
      if (ns.score <= -settings.newsThreshold && !blocked(t, "WATCH", p.brokerId)) {
        drafts.push(base(t, "WATCH", p.brokerId, `Bearish news on ${t}, which you hold`, [
          `News score ${ns.score}`, `Still ${(i.last - stop).toFixed(2)} above your stop, so no action yet`,
        ], i.last, ns, 72));
      }
    }

    if (!positions.length && watch.includes(t)) {
      const ok = ns.score >= settings.newsThreshold && i.last > i.ema50 && i.rsi < 72 && i.volRatio >= 1;
      if (!ok) continue;
      const brokerId = settings.defaultBroker[market] ?? marketBrokers[0]?.id ?? null;
      const broker = brokers.find((b) => b.id === brokerId);
      const currency = broker?.currency ?? (market === "US" ? "USD" : "PHP");
      if (blocked(t, "BUY", brokerId)) continue;
      const entry = f2(i.last), stop = f2(entry - 2 * i.atr), target = f2(entry + 3 * i.atr);
      const perShare = entry - stop;
      const totalInCur = currency === "USD" ? val.totalPhp / fx : val.totalPhp;
      if (perShare <= 0 || totalInCur <= 0) continue;
      let qty = Math.min((totalInCur * settings.riskPerTrade) / perShare, (totalInCur * settings.maxPositionPct) / entry);
      qty = roundQty(market, qty, entry);
      if (qty <= 0) continue;
      const cash = brokerId ? portfolio.cash[brokerId] ?? 0 : 0;
      const needed = f2(Math.max(0, qty * entry * 1.003 - cash));
      drafts.push({
        ...base(t, "BUY", brokerId, `${t}: positive news on an uptrend`, [
          `News score +${ns.score}`,
          `Price ${entry} is above its 50-day average (${i.ema50.toFixed(2)}), RSI ${i.rsi.toFixed(0)}, volume ${i.volRatio.toFixed(1)}x normal`,
          `Plan: ${qty} shares, stop ${stop}, target ${target}, ${(qty * perShare).toFixed(2)} at risk`,
        ], entry, ns, settings.buyTtlH),
        plan: { qty, entry, stop, target, cashNeeded: needed || undefined },
      });
    }
  }

  // 4. Save and alert
  const created: Suggestion[] = [];
  if (drafts.length) {
    const wb = col.suggestions().firestore.batch();
    for (const d of drafts) {
      const ref = col.suggestions().doc();
      wb.set(ref, d);
      created.push({ id: ref.id, ...d });
    }
    await wb.commit();
    const urgent = created.filter((s) => s.action !== "WATCH");
    await emailSuggestions(settings.alertEmail, urgent).catch((e) => console.error("Alert email failed", e));
  }
  return { market, universe: universe.length, headlines: items.length, scored, created: created.length };
}

export type { Settings };
