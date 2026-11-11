import { col, listBrokers, recomputePortfolio } from "@/lib/server/db";
import { handler, HttpError, readJson, requireOwner } from "@/lib/server/http";
import type { Broker, Connection, Currency, Market } from "@/lib/types";

const MARKETS: Market[] = ["PH", "US"];
const CURRENCIES: Currency[] = ["PHP", "USD"];
const CONNECTIONS: Connection[] = ["alpaca", "email", "manual"];

function validate(b: Partial<Broker>) {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new HttpError(400, "Name is required");
  if (name.length > 60) throw new HttpError(400, "Name is too long (60 characters max)");
  if (!MARKETS.includes(b.market as Market)) throw new HttpError(400, "Market must be PH or US");
  if (!CURRENCIES.includes(b.currency as Currency)) throw new HttpError(400, "Currency must be PHP or USD");
  if (!CONNECTIONS.includes(b.connection as Connection)) throw new HttpError(400, "Unknown connection type");
  if (b.connection === "alpaca" && b.market !== "US") throw new HttpError(400, "Alpaca is for US stocks");
  return name;
}

export const POST = handler(async (req: Request) => {
  await requireOwner(req);
  const b = await readJson<Partial<Broker>>(req);
  const name = validate(b);
  if ((await listBrokers()).some((x) => x.name.toLowerCase() === name.toLowerCase() && x.market === b.market)) {
    throw new HttpError(409, `You already have a ${b.market} broker called ${name}`);
  }
  const ref = col.brokers().doc();
  await ref.set({ name, market: b.market, currency: b.currency, connection: b.connection, createdAt: new Date().toISOString() });
  return { id: ref.id };
});

export const PATCH = handler(async (req: Request) => {
  await requireOwner(req);
  const b = await readJson<Partial<Broker> & { id: string }>(req);
  if (!b?.id || typeof b.id !== "string") throw new HttpError(400, "id required");
  const ref = col.brokers().doc(b.id);
  const cur = await ref.get();
  if (!cur.exists) throw new HttpError(404, "Broker not found");
  const next = { ...(cur.data() as Broker), ...b };
  const name = validate(next);
  await ref.update({ name, connection: next.connection });
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
