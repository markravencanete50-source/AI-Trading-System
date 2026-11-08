import { recomputePortfolio, listBrokers } from "@/lib/server/db";
import { handler, requireOwner } from "@/lib/server/http";
import { refreshHeldPrices, syncAlpaca, updateFx, writeSnapshot } from "@/lib/signals/daily";

export const maxDuration = 60;

/** "Sync now" button: pull Alpaca activity, refresh prices of holdings and today's snapshot. */
export const POST = handler(async (req: Request) => {
  await requireOwner(req);
  const fx = await updateFx();
  const added = await syncAlpaca(await listBrokers());
  const pf = await recomputePortfolio();
  await refreshHeldPrices(pf.positions);
  const snapshot = await writeSnapshot();
  return { fx, added, snapshot };
});
