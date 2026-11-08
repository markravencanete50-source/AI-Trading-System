"use client";
import { useState } from "react";
import { useData } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { BrokerTag, Card, useAction } from "@/components/ui";
import { api } from "@/lib/client/firebase";
import { money, today } from "@/lib/format";
import type { Broker, Suggestion } from "@/lib/types";

export default function Suggestions() {
  const { suggestions, brokers } = useData();
  const open = suggestions.filter((s) => s.status === "open");
  const past = suggestions.filter((s) => s.status !== "open").slice(0, 30);
  return (
    <Shell title="Suggestions">
      <div className="stack">
        <Card title="Open" sub="Rule-based signals with their reasons. Brokers with an API can execute from here; for the rest, place the order yourself and log what you got.">
          {open.length === 0 ? <div className="empty">Nothing open. Scans run every 15 minutes while PSE and US markets are open.</div>
            : open.map((s) => <Item key={s.id} s={s} broker={brokers.find((b) => b.id === s.brokerId)} />)}
        </Card>
        {past.length > 0 && (
          <Card title="Recent decisions">
            <div className="tbl-wrap"><table className="t">
              <thead><tr><th>When</th><th>Signal</th><th>Broker</th><th>Status</th><th className="r">Price then</th></tr></thead>
              <tbody>{past.map((s) => (
                <tr key={s.id}><td>{s.createdAt.slice(0, 10)}</td><td className="tk">{s.action} {s.ticker}<span className={`mkt ${s.market}`}>{s.market}</span></td>
                  <td><BrokerTag broker={brokers.find((b) => b.id === s.brokerId)} /></td><td>{s.status}</td><td className="r">{s.priceAt.toFixed(2)}</td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}
      </div>
    </Shell>
  );
}

function Item({ s, broker }: { s: Suggestion; broker?: Broker }) {
  const { busy, run, view } = useAction();
  const [logging, setLogging] = useState(false);
  const [fill, setFill] = useState({ qty: s.plan?.qty ?? 0, price: s.plan?.entry ?? s.priceAt, fee: 0, date: today() });
  const api_ = broker?.connection === "alpaca";
  const cur = broker?.currency ?? (s.market === "US" ? "USD" : "PHP");
  const act = (body: object) => run(async () => { await api(`/api/suggestions/${s.id}`, { json: body }); });

  return (
    <div className="sugg">
      <div className={`verb ${s.action}`}>{s.action}<small>{s.ticker}<span className={`mkt ${s.market}`}>{s.market}</span></small></div>
      <div>
        <h3>{s.headline}</h3>
        <BrokerTag broker={broker} />
        <ul>{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        {s.news.length > 0 && <ul>{s.news.map((n, i) => <li key={i}><a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a> ({n.impact > 0 ? "+" : ""}{n.impact})</li>)}</ul>}
        {s.plan?.cashNeeded ? <div className="cashnote">Transfer {money(s.plan.cashNeeded, cur)} from your bank to {broker?.name ?? "the broker"} first, then log the deposit.</div> : null}
        {logging && (
          <div className="form" style={{ marginTop: 12 }}>
            <div><label>Shares</label><input type="number" value={fill.qty} onChange={(e) => setFill({ ...fill, qty: +e.target.value })} /></div>
            <div><label>Price</label><input type="number" step="0.0001" value={fill.price} onChange={(e) => setFill({ ...fill, price: +e.target.value })} /></div>
            <div><label>Total fees</label><input type="number" step="0.01" value={fill.fee} onChange={(e) => setFill({ ...fill, fee: +e.target.value })} /></div>
            <div><label>Date</label><input type="date" value={fill.date} onChange={(e) => setFill({ ...fill, date: e.target.value })} /></div>
            <button className="btn primary" disabled={busy} onClick={() => act({ do: "done", fill })}>Save to ledger</button>
          </div>
        )}
        {view}
      </div>
      <div className="acts">
        {s.action === "WATCH" ? (
          <button className="btn" disabled={busy} onClick={() => act({ do: "dismiss" })}>Got it</button>
        ) : api_ ? (
          <>
            <button className="btn primary" disabled={busy} onClick={() => act({ do: "execute" })}>
              {busy ? "Checking live price" : `Approve: ${s.action === "BUY" ? "buy" : "sell"} ${s.plan?.qty ?? ""} on ${broker?.name}`}
            </button>
            <button className="btn" disabled={busy} onClick={() => act({ do: "dismiss" })}>Dismiss</button>
            <span className="how">API: places the order after a live price check</span>
          </>
        ) : (
          <>
            <button className="btn primary" disabled={busy} onClick={() => setLogging((v) => !v)}>{logging ? "Cancel" : `I placed it in ${broker?.name ?? "my broker"}`}</button>
            <button className="btn" disabled={busy} onClick={() => act({ do: "dismiss" })}>Dismiss</button>
            <span className="how">No API: place it yourself, then log the fill</span>
          </>
        )}
      </div>
    </div>
  );
}
