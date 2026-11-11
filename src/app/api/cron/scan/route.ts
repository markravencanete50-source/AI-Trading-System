import { marketOpen } from "@/lib/market/hours";
import { col } from "@/lib/server/db";
import { handler, HttpError, requireCron } from "@/lib/server/http";
import { runScan } from "@/lib/signals/engine";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** One scan per market at a time. A late GitHub run overlapping the next one would create duplicate suggestions. */
async function acquire(market: string) {
  const ref = col.meta().doc(`lock_scan_${market}`);
  const ok = await ref.firestore.runTransaction(async (t) => {
    const cur = await t.get(ref);
    const until = (cur.get("until") as number | undefined) ?? 0;
    if (until > Date.now()) return false;
    t.set(ref, { until: Date.now() + 5 * 60_000 });
    return true;
  });
  return ok ? ref : null;
}

const run = handler(async (req: Request) => {
  requireCron(req);
  const url = new URL(req.url);
  const market = url.searchParams.get("market");
  if (market !== "PH" && market !== "US") throw new HttpError(400, "market must be PH or US");
  if (!marketOpen(market) && url.searchParams.get("force") !== "1") return { skipped: "market closed", market };
  const lock = await acquire(market);
  if (!lock) return { skipped: "another scan is still running", market };
  try {
    return await runScan(market);
  } finally {
    await lock.set({ until: 0 }).catch(() => {});
  }
});

export const GET = run;
export const POST = run;
