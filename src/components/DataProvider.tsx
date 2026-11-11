"use client";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fbAuth, fbDb } from "@/lib/client/firebase";
import type { DisplayCurrency } from "@/lib/format";
import { computePortfolio, valuation, type Valuation } from "@/lib/money";
import { mergeSettings } from "@/lib/settings";
import type { Broker, Portfolio, PriceDoc, Settings, Snapshot, Suggestion, Tx } from "@/lib/types";

interface Data {
  user: User;
  ready: boolean;
  brokers: Broker[];
  txs: Tx[];
  suggestions: Suggestion[];
  prices: Record<string, PriceDoc>;
  snapshots: Snapshot[];
  settings: Settings;
  portfolio: Portfolio;
  val: Valuation;
  fx: number;
  display: DisplayCurrency;
  setDisplay: (c: DisplayCurrency) => void;
  brokerName: (id: string | null | undefined) => string;
}

const Ctx = createContext<Data | null>(null);
export const useData = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData outside DataProvider");
  return c;
};

function useCollection<T>(user: User | null, build: () => ReturnType<typeof query> | ReturnType<typeof collection>, mark: () => void) {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(build(), (s) => { setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T)); mark(); },
      (e) => { console.error("Firestore subscription failed", e); mark(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  return rows;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // Count each source once (first answer), not every live update, so "ready" really means all six have arrived.
  const [loadedKeys, setLoadedKeys] = useState<Record<string, true>>({});
  const [display, setDisplay] = useState<DisplayCurrency>("PHP");
  const [savedSettings, setSavedSettings] = useState<Partial<Settings>>();
  const markAs = (key: string) => () => setLoadedKeys((k) => (k[key] ? k : { ...k, [key]: true }));

  useEffect(() => onAuthStateChanged(fbAuth(), setUser), []);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(fbDb(), "meta", "settings"), (d) => { setSavedSettings(d.data() as Partial<Settings> | undefined); markAs("settings")(); }, () => markAs("settings")());
  }, [user]);

  const brokers = useCollection<Broker>(user ?? null, () => collection(fbDb(), "brokers"), markAs("brokers"));
  const txs = useCollection<Tx>(user ?? null, () => query(collection(fbDb(), "transactions"), orderBy("date", "desc")), markAs("transactions"));
  const suggestions = useCollection<Suggestion>(user ?? null, () => query(collection(fbDb(), "suggestions"), orderBy("createdAt", "desc"), limit(300)), markAs("suggestions"));
  const priceRows = useCollection<PriceDoc & { id: string }>(user ?? null, () => collection(fbDb(), "prices"), markAs("prices"));
  const snapshots = useCollection<Snapshot>(user ?? null, () => query(collection(fbDb(), "snapshots"), orderBy("date", "desc"), limit(400)), markAs("snapshots"));

  const value = useMemo(() => {
    if (!user) return null;
    const settings = mergeSettings(savedSettings);
    const prices = Object.fromEntries(priceRows.map((p) => [p.id, p]));
    const portfolio = computePortfolio(brokers, txs);
    const fx = settings.fxUsdPhp;
    const names = new Map(brokers.map((b) => [b.id, b.name]));
    return {
      user, ready: Object.keys(loadedKeys).length >= 6, brokers: [...brokers].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), txs, suggestions, prices,
      snapshots: [...snapshots].reverse(), settings, portfolio, val: valuation(portfolio, brokers, prices, fx), fx,
      display, setDisplay, brokerName: (id: string | null | undefined) => (id && names.get(id)) || "No broker",
    } satisfies Data;
  }, [user, loadedKeys, savedSettings, brokers, txs, suggestions, priceRows, snapshots, display]);

  if (user === undefined) return <div className="center muted">Loading</div>;
  if (!user) return <SignIn />;
  const owner = process.env.NEXT_PUBLIC_OWNER_EMAIL?.toLowerCase();
  if (owner && user.email?.toLowerCase() !== owner) {
    return (
      <div className="center">
        <div className="card narrow">
          <h1>Not this account</h1>
          <p className="muted">{user.email} cannot open this dashboard. Sign in with the owner account.</p>
          <button className="btn" onClick={() => signOut(fbAuth())}>Sign out</button>
        </div>
      </div>
    );
  }
  // Hold the screens until every collection has answered, so forms never start with an empty broker list.
  if (!value?.ready) return <div className="center muted">Loading your data</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function SignIn() {
  const [err, setErr] = useState("");
  return (
    <div className="center">
      <div className="card narrow">
        <h1>Portfolio HQ</h1>
        <p className="muted">Your brokers, money and market signals in one place.</p>
        <button className="btn primary" onClick={() => signInWithPopup(fbAuth(), new GoogleAuthProvider()).catch((e) => setErr(e.message))}>
          Sign in with Google
        </button>
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}
