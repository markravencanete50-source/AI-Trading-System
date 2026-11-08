import { handler, requireCron } from "@/lib/server/http";
import { runDaily } from "@/lib/signals/daily";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Vercel Cron sends GET with "Authorization: Bearer <CRON_SECRET>".
export const GET = handler(async (req: Request) => {
  requireCron(req);
  return runDaily();
});
