import "server-only";
import { computePortfolio } from "../money";
import { mergeSettings } from "../settings";
import type { Broker, Portfolio, PriceDoc, Settings, Suggestion, Tx } from "../types";
import { firestore } from "./firebase";

export const col = {
  brokers: () => firestore().collection("brokers"),
  txs: () => firestore().collection("transactions"),
  suggestions: () => firestore().collection("suggestions"),
  prices: () => firestore().collection("prices"),
  news: () => firestore().collection("news"),
  snapshots: () => firestore().collection("snapshots"),
  pseIds: () => firestore().collection("pseIds"),
  meta: () => firestore().collection("meta"),
};

const withId = <T>(d: FirebaseFirestore.DocumentSnapshot) => ({ id: d.id, ...d.data() }) as T;

export async function listBrokers() {
  const s = await col.brokers().get();
  return s.docs.map((d) => withId<Broker>(d));
}

export async function getBroker(id: string) {
  const d = await col.brokers().doc(id).get();
  return d.exists ? withId<Broker>(d) : null;
}

export async function listTxs() {
  const s = await col.txs().get();
  return s.docs.map((d) => withId<Tx>(d));
}

export async function getSettings(): Promise<Settings> {
  const d = await col.meta().doc("settings").get();
  return mergeSettings(d.data() as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>) {
  await col.meta().doc("settings").set(patch, { merge: true });
}

/** Cached portfolio so 15-minute scans read one document instead of the whole ledger. */
export async function getPortfolio(): Promise<Portfolio> {
  const d = await col.meta().doc("portfolio").get();
  if (d.exists) return d.data() as Portfolio;
  return recomputePortfolio();
}

export async function recomputePortfolio(): Promise<Portfolio> {
  const [brokers, txs] = await Promise.all([listBrokers(), listTxs()]);
  const pf = { ...computePortfolio(brokers, txs), updatedAt: new Date().toISOString() };
  await col.meta().doc("portfolio").set(pf);
  return pf;
}

export async function getPrices(): Promise<Record<string, PriceDoc>> {
  const s = await col.prices().get();
  return Object.fromEntries(s.docs.map((d) => [d.id, d.data() as PriceDoc]));
}

export async function recentSuggestions(days: number) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const s = await col.suggestions().where("createdAt", ">=", since).get();
  return s.docs.map((d) => withId<Suggestion>(d));
}

export async function getSuggestion(id: string) {
  const d = await col.suggestions().doc(id).get();
  return d.exists ? withId<Suggestion>(d) : null;
}
