"use client";
import { useState, type ReactNode } from "react";
import type { Broker } from "@/lib/types";

export function Card({ title, sub, children, className = "" }: { title?: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2>{title}</h2>}
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  );
}

export function Kpi({ k, n, s }: { k: string; n: ReactNode; s?: ReactNode }) {
  return <div className="card kpi"><div className="k">{k}</div><div className="n num">{n}</div>{s && <div className="s">{s}</div>}</div>;
}

export function BrokerTag({ broker }: { broker?: Broker }) {
  if (!broker) return <span className="src">No broker</span>;
  return <span className="src"><span className={`dot ${broker.market}`} />{broker.name}</span>;
}

export const CONNECTION_LABEL = { alpaca: "API sync (Alpaca)", email: "Email import", manual: "Manual and statement import" } as const;

/** Runs an async action with a busy flag and an inline message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ ok: true, text: t }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const view = msg && <p className={msg.ok ? "okmsg" : "error"} role="status">{msg.text}</p>;
  return { busy, run, view };
}
