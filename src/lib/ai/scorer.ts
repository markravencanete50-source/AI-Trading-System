import "server-only";
import { createHash } from "node:crypto";
import type { NewsItem } from "../market/types";
import { col } from "../server/db";
import { cfg } from "../server/config";
import { anthropic, parseJson, textOf } from "./client";

const EVENT_TYPES = ["earnings", "guidance", "m_and_a", "analyst", "legal_regulatory", "product",
  "management", "capital_raise", "dividend_buyback", "macro", "sector", "other"] as const;

const SYSTEM = `You are an equity news analyst. Each input item has a stock ticker, its market (US, or PH for the Philippine Stock Exchange), a headline and an optional summary. Judge the likely price impact on THAT ticker over the next 1 to 5 trading days.

Return ONLY a JSON array with one object per input item, same order, no prose, no code fences:
[{"i": <input index>, "relevant": true|false, "event_type": one of ${JSON.stringify(EVENT_TYPES)}, "direction": number -1 to 1, "magnitude": integer 1 to 5, "confidence": number 0 to 1, "novelty": "new" or "rehash"}]

Rules:
- relevant=false when the item is not really about this ticker (name collision, passing mention, multi-stock roundup). Then direction 0, magnitude 1, confidence 0.
- magnitude: 1 routine or noise; 2 minor; 3 meaningful company-specific news; 4 major (earnings surprise, guidance change, large contract, regulatory action, rating change by a major bank); 5 transformational (takeover, fraud, bankruptcy, delisting).
- direction is the expected price move, not the tone of the writing. Outcomes the market already expected get small values.
- novelty "rehash" for recaps, opinion, "stocks to watch" lists, or articles explaining a move that already happened.
- A PSE disclosure title alone (e.g. "Press Release") is ambiguous: keep confidence at or below 0.3 unless the title itself states the event.
- For PH stocks, PSE disclosures, BSP rate decisions and government policy often matter more than global news.
- confidence is how sure you are of the direction; keep it low for ambiguous headlines.`;

export interface ScoredNews extends NewsItem {
  eventType: string;
  direction: number;
  magnitude: number;
  confidence: number;
  novelty: "new" | "rehash";
  scoredAt: string;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
export const newsId = (n: NewsItem) => createHash("sha256").update(`${n.ticker}|${norm(n.headline)}`).digest("hex").slice(0, 24);
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Scores unseen headlines in batches of 20 under a daily cap. Returns how many were scored. */
export async function scoreAndStore(items: NewsItem[], maxPerDay: number) {
  const fresh = new Map<string, NewsItem>();
  for (const it of items) if (it.headline) fresh.set(newsId(it), it);
  if (!fresh.size) return 0;

  const ids = [...fresh.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => col.news().doc(id));
    const snaps = await col.news().firestore.getAll(...refs);
    for (const s of snaps) if (s.exists) fresh.delete(s.id);
  }
  if (!fresh.size) return 0;

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const used = (await col.news().where("scoredAt", ">=", dayStart.toISOString()).count().get()).data().count;
  const todo = [...fresh.entries()].slice(0, Math.max(0, maxPerDay - used));
  if (todo.length < fresh.size) console.warn(`Daily scoring cap reached, skipped ${fresh.size - todo.length}`);

  let scored = 0;
  for (let i = 0; i < todo.length; i += 20) {
    const chunk = todo.slice(i, i + 20);
    try {
      const msg = await anthropic().messages.create({
        model: cfg.aiModel,
        max_tokens: 120 * chunk.length + 200,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: JSON.stringify(chunk.map(([, n], k) => ({ i: k, ticker: n.ticker, market: n.market, headline: n.headline, summary: n.summary.slice(0, 300) }))),
        }],
      });
      const results = parseJson<Record<string, unknown>[]>(textOf(msg), "[");
      const byI = new Map(results.map((r) => [Number(r.i), r]));
      const batch = col.news().firestore.batch();
      const now = new Date().toISOString();
      chunk.forEach(([id, n], k) => {
        const r = byI.get(k);
        if (!r) return;
        const relevant = r.relevant !== false;
        const doc: ScoredNews = {
          ...n,
          eventType: EVENT_TYPES.includes(r.event_type as never) ? String(r.event_type) : "other",
          direction: relevant ? clamp(r.direction, -1, 1, 0) : 0,
          magnitude: relevant ? Math.round(clamp(r.magnitude, 1, 5, 1)) : 1,
          confidence: relevant ? clamp(r.confidence, 0, 1, 0) : 0,
          novelty: r.novelty === "new" ? "new" : "rehash",
          scoredAt: now,
        };
        batch.set(col.news().doc(id), doc);
        scored++;
      });
      await batch.commit();
    } catch (e) {
      console.error("Scoring batch failed", e);
    }
  }
  return scored;
}

export async function recentNews(market: "PH" | "US", hours = 72) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const s = await col.news().where("publishedAt", ">=", since).get();
  return s.docs.map((d) => d.data() as ScoredNews).filter((n) => n.market === market);
}
