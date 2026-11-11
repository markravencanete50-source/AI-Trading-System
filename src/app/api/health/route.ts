import { cfg } from "@/lib/server/config";
import { col } from "@/lib/server/db";
import { handler, requireOwner } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Owner-only setup check: which integrations are configured (true/false only, never values) and when jobs last ran. */
export const GET = handler(async (req: Request) => {
  await requireOwner(req);
  const [lastPrice, lastSnap] = await Promise.all([
    col.prices().orderBy("updatedAt", "desc").limit(1).get(),
    col.snapshots().orderBy("date", "desc").limit(1).get(),
  ]);
  return {
    config: {
      firebaseAdmin: !!(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PROJECT_ID),
      anthropic: !!cfg.anthropicKey,
      cronSecret: !!cfg.cronSecret,
      webhookSecret: !!cfg.webhookSecret,
      alpaca: !!(cfg.alpaca.keyId && cfg.alpaca.secret),
      alpacaPaper: cfg.alpaca.paper,
      email: !!(cfg.smtp.user && cfg.smtp.pass),
    },
    lastPriceUpdate: (lastPrice.docs[0]?.get("updatedAt") as string | undefined) ?? null,
    lastSnapshot: (lastSnap.docs[0]?.get("date") as string | undefined) ?? null,
  };
});
