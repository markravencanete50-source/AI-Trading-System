import { marketOpen } from "@/lib/market/hours";
import { handler, HttpError, requireCron } from "@/lib/server/http";
import { runScan } from "@/lib/signals/engine";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const run = handler(async (req: Request) => {
  requireCron(req);
  const url = new URL(req.url);
  const market = url.searchParams.get("market");
  if (market !== "PH" && market !== "US") throw new HttpError(400, "market must be PH or US");
  if (!marketOpen(market) && url.searchParams.get("force") !== "1") return { skipped: "market closed", market };
  return runScan(market);
});

export const GET = run;
export const POST = run;
