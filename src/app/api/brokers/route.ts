import { col, recomputePortfolio } from "@/lib/server/db";
import { handler, HttpError, requireOwner } from "@/lib/server/http";
import type { Broker, Connection, Currency, Market } from "@/lib/types";

const MARKETS: Market[] = ["PH", "US"];
const CURRENCIES: Currency[] = ["PHP", "USD"];
const CONNECTIONS: Connection[] = ["alpaca", "email", "manual"];

function validate(b: Partial<Broker>) {
  if (!b.name?.trim()) throw new HttpError(400, "Name is required");
  if (!MARKETS.includes(b.market as Market)) throw new HttpError(400, "Market must be PH or US");
  if (!CURRENCIES.includes(b.currency as Currency)) throw new HttpError(400, "Currency must be PHP or USD");
  if (!CONNECTIONS.includes(b.connection as Connection)) throw new HttpError(400, "Unknown connection type");
  if (b.connection === "alpaca" && b.market !== "US") throw new HttpError(400, "Alpaca is for US stocks");
}

export const POST = handler(async (req: Request) => {
  await requireOwner(req);
  const b = (await req.json()) as Partial<Broker>;
  validate(b);
  const ref = col.brokers().doc();
  await ref.set({ name: b.name!.trim(), market: b.market, currency: b.currency, connection: b.connection, createdAt: new Date().toISOString() });
  return { id: ref.id };
});

export const PATCH = handler(async (req: Request) => {
  await requireOwner(req);
  const b = (await req.json()) as Partial<Broker> & { id: string };
  const ref = col.brokers().doc(b.id);
  const cur = await ref.get();
  if (!cur.exists) throw new HttpError(404, "Broker not found");
  const next = { ...(cur.data() as Broker), ...b };
  validate(next);
  await ref.update({ name: next.name.trim(), connection: next.connection });
  return { id: b.id };
});

export const DELETE = handler(async (req: Request) => {
  await requireOwner(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id required");
  const used = await col.txs().where("brokerId", "==", id).limit(1).get();
  if (!used.empty) throw new HttpError(409, "This broker has transactions. Delete those first.");
  await col.brokers().doc(id).delete();
  await recomputePortfolio();
  return { id };
});
