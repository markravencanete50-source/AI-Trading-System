import { getSettings, saveSettings } from "@/lib/server/db";
import { handler, HttpError, requireOwner } from "@/lib/server/http";
import type { Settings } from "@/lib/types";

const NUMBERS: [keyof Settings, number, number][] = [
  ["riskPerTrade", 0.001, 0.05], ["maxPositionPct", 0.05, 1], ["newsThreshold", 0.5, 10], ["newsHalfLifeH", 1, 168],
  ["cooldownH", 1, 240], ["buyTtlH", 1, 72], ["maxSlippagePct", 0.001, 0.1], ["maxScoredPerDay", 0, 5000], ["fxUsdPhp", 20, 200],
];

export const PUT = handler(async (req: Request) => {
  await requireOwner(req);
  const body = (await req.json()) as Partial<Settings>;
  const patch: Partial<Settings> = {};
  for (const [k, lo, hi] of NUMBERS) {
    if (body[k] === undefined) continue;
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${k} must be between ${lo} and ${hi}`);
    (patch as Record<string, unknown>)[k] = v;
  }
  if (body.watchlist) {
    const us = (body.watchlist.US ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean);
    const ph: Record<string, string[]> = {};
    for (const [t, names] of Object.entries(body.watchlist.PH ?? {})) {
      const k = t.trim().toUpperCase();
      if (k) ph[k] = names.map((n) => n.trim()).filter(Boolean);
    }
    patch.watchlist = { US: us, PH: ph };
  }
  if (body.phFeeds) patch.phFeeds = body.phFeeds.filter((u) => /^https?:\/\//.test(u));
  if (body.defaultBroker) patch.defaultBroker = body.defaultBroker;
  if (body.alertEmail !== undefined) patch.alertEmail = String(body.alertEmail).trim();
  await saveSettings(patch);
  return getSettings();
});
