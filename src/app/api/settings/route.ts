import { getSettings, listBrokers, saveSettings } from "@/lib/server/db";
import { handler, HttpError, readJson, requireOwner } from "@/lib/server/http";
import { safeFeedUrl } from "@/lib/server/urls";
import type { Settings } from "@/lib/types";

const NUMBERS: [keyof Settings, number, number][] = [
  ["riskPerTrade", 0.001, 0.05], ["maxPositionPct", 0.05, 1], ["newsThreshold", 0.5, 10], ["newsHalfLifeH", 1, 168],
  ["cooldownH", 1, 240], ["buyTtlH", 1, 72], ["maxSlippagePct", 0.001, 0.1], ["maxScoredPerDay", 0, 5000], ["fxUsdPhp", 20, 200],
];
const TICKER = /^[A-Z0-9.\-]{1,12}$/;
const strings = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new HttpError(400, `${what} must be a list of text`);
  return v as string[];
};

export const PUT = handler(async (req: Request) => {
  await requireOwner(req);
  const body = await readJson<Partial<Settings>>(req);
  const patch: Partial<Settings> = {};
  for (const [k, lo, hi] of NUMBERS) {
    if (body[k] === undefined) continue;
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${k} must be between ${lo} and ${hi}`);
    (patch as Record<string, unknown>)[k] = v;
  }
  if (body.watchlist) {
    const us = [...new Set(strings(body.watchlist.US ?? [], "US tickers").map((t) => t.trim().toUpperCase()).filter(Boolean))];
    const ph: Record<string, string[]> = {};
    const rawPh = body.watchlist.PH ?? {};
    if (typeof rawPh !== "object" || Array.isArray(rawPh)) throw new HttpError(400, "PH watchlist is malformed");
    for (const [t, names] of Object.entries(rawPh)) {
      const k = t.trim().toUpperCase();
      if (k) ph[k] = strings(names, `Names for ${k}`).map((n) => n.trim().slice(0, 80)).filter(Boolean);
    }
    const bad = [...us, ...Object.keys(ph)].find((t) => !TICKER.test(t));
    if (bad) throw new HttpError(400, `"${bad}" is not a valid ticker`);
    if (us.length > 60 || Object.keys(ph).length > 60) throw new HttpError(400, "Keep each watchlist to 60 stocks or fewer");
    patch.watchlist = { US: us, PH: ph };
  }
  if (body.phFeeds) {
    const feeds = strings(body.phFeeds, "Feeds").map((u) => u.trim()).filter(Boolean);
    if (feeds.length > 10) throw new HttpError(400, "Use 10 feeds or fewer");
    const bad = feeds.find((u) => !safeFeedUrl(u));
    if (bad) throw new HttpError(400, `Feed must be a public https address: ${bad.slice(0, 80)}`);
    patch.phFeeds = [...new Set(feeds)];
  }
  if (body.defaultBroker) {
    const brokers = await listBrokers();
    const out: Settings["defaultBroker"] = { PH: null, US: null };
    for (const m of ["PH", "US"] as const) {
      const id = body.defaultBroker[m];
      if (!id) continue;
      if (!brokers.some((b) => b.id === id && b.market === m)) throw new HttpError(400, `Default ${m} broker must be one of your ${m} brokers`);
      out[m] = id;
    }
    patch.defaultBroker = out;
  }
  if (body.alertEmail !== undefined) {
    const e = String(body.alertEmail).trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "Alert email is not a valid address");
    patch.alertEmail = e.slice(0, 120);
  }
  await saveSettings(patch);
  return getSettings();
});
