"use client";
import { useState } from "react";
import { useData } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { Card, CONNECTION_LABEL, useAction } from "@/components/ui";
import { api } from "@/lib/client/firebase";
import { money } from "@/lib/format";
import type { Broker, Connection, Currency, Market, Tx, TxType } from "@/lib/types";

const TYPES: TxType[] = ["deposit", "withdrawal", "buy", "sell", "dividend", "fee", "interest"];

export default function Brokers() {
  const { brokers, txs } = useData();
  const review = txs.filter((t) => t.status === "needs_review");
  const sync = useAction();
  return (
    <Shell title="Brokers" actions={
      brokers.some((b) => b.connection === "alpaca") && (
        <button className="btn" disabled={sync.busy} onClick={() => sync.run(async () => {
          const r = await api<{ added: number }>("/api/sync", { json: {} });
          return `Synced. ${r.added} new Alpaca activit${r.added === 1 ? "y" : "ies"}.`;
        })}>{sync.busy ? "Syncing" : "Sync now"}</button>
      )
    }>
      <div className="stack">
        {sync.view}
        {review.length > 0 && (
          <Card title={`${review.length} imported row${review.length > 1 ? "s" : ""} to check`} sub="These came from forwarded emails. Fix anything Claude misread, then confirm. They do not count until confirmed.">
            {review.map((t) => <ReviewRow key={t.id} t={t} broker={brokers.find((b) => b.id === t.brokerId)} />)}
          </Card>
        )}
        {brokers.map((b) => <BrokerCard key={b.id} b={b} count={txs.filter((t) => t.brokerId === b.id).length} />)}
        <AddBroker />
        {brokers.length > 0 && <ImportPanel brokers={brokers} />}
      </div>
    </Shell>
  );
}

function BrokerCard({ b, count }: { b: Broker; count: number }) {
  const { busy, run, view } = useAction();
  const api_ = b.connection === "alpaca";
  return (
    <Card>
      <h2>{b.name} <span className={`pill ${api_ ? "gain" : b.connection === "email" ? "warn" : "neutral"}`}>{CONNECTION_LABEL[b.connection]}</span></h2>
      <p className="sub">{b.market} stocks in {b.currency}. {count} transaction{count === 1 ? "" : "s"}.{b.lastSyncAt ? ` Last sync ${b.lastSyncAt.slice(0, 16).replace("T", " ")} UTC.` : ""}</p>
      <div className="caps">
        <span className={`cap ${api_ || b.connection === "email" ? "yes" : ""}`}>Trades: {api_ ? "automatic" : b.connection === "email" ? "from forwarded emails" : "statement import or manual"}</span>
        <span className={`cap ${api_ ? "yes" : ""}`}>Bank transfers: {api_ ? "automatic" : "you log them"}</span>
        <span className={`cap ${api_ ? "yes" : ""}`}>Orders: {api_ ? "after you approve" : "you place them"}</span>
      </div>
      {b.connection === "email" && (
        <p className="hint">Make.com: Gmail Watch emails on this broker&apos;s confirmation label, then HTTP POST to /api/import/webhook with header x-webhook-secret and body {"{"} brokerId: &quot;{b.id}&quot;, messageId, subject, text {"}"}.</p>
      )}
      <div className="row">
        <button className="btn small danger" disabled={busy || count > 0} title={count > 0 ? "Delete its transactions first" : ""}
          onClick={() => confirm(`Remove ${b.name}?`) && run(async () => { await api(`/api/brokers?id=${b.id}`, { method: "DELETE" }); })}>Remove broker</button>
      </div>
      {view}
    </Card>
  );
}

function AddBroker() {
  const [f, setF] = useState<{ name: string; market: Market; currency: Currency; connection: Connection }>({ name: "", market: "PH", currency: "PHP", connection: "manual" });
  const { busy, run, view } = useAction();
  return (
    <Card title="Add a broker" sub="Pick how it stays up to date. Most PH brokers have no API, so use email import or statements. You can switch later without losing history.">
      <div className="form">
        <div><label>Name</label><input value={f.name} placeholder="COL Financial" onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label>Market</label><select value={f.market} onChange={(e) => { const m = e.target.value as Market; setF({ ...f, market: m, currency: m === "US" ? "USD" : "PHP", connection: m === "PH" && f.connection === "alpaca" ? "manual" : f.connection }); }}>
          <option value="PH">Philippines (PSE)</option><option value="US">United States</option></select></div>
        <div><label>Account currency</label><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}><option>PHP</option><option>USD</option></select></div>
        <div><label>Connection</label><select value={f.connection} onChange={(e) => setF({ ...f, connection: e.target.value as Connection })}>
          {f.market === "US" && <option value="alpaca">Alpaca API</option>}<option value="email">Email import</option><option value="manual">Manual and statements</option></select></div>
        <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/api/brokers", { json: f }); setF({ ...f, name: "" }); return "Broker added."; })}>Add</button>
      </div>
      {view}
    </Card>
  );
}

type Draft = { type: TxType; date: string; ticker: string | null; qty: number | null; price: number | null; fee: number | null; amount: number; note: string; confidence: number; keep: boolean };

function ImportPanel({ brokers }: { brokers: Broker[] }) {
  const [brokerId, setBrokerId] = useState(brokers[0].id);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const { busy, run, view } = useAction();
  const broker = brokers.find((b) => b.id === brokerId)!;
  const upd = (i: number, k: keyof Draft, v: string | boolean) => setDrafts(drafts.map((d, j) => j !== i ? d : {
    ...d, [k]: typeof v === "boolean" || k === "type" || k === "date" || k === "ticker" || k === "note" ? v : v === "" ? null : Number(v),
  }));

  return (
    <Card title="Import a statement or confirmation" sub="Paste text, or attach a CSV, PDF statement or screenshot. Claude drafts the transactions, you check them, nothing saves until you do.">
      <div className="field"><label>Broker</label>
        <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>{brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
      <div className="field"><label>Paste text</label><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a trade confirmation email or statement rows" /></div>
      <div className="field"><label>Or attach a file (PDF, CSV, PNG, JPG, up to 4 MB)</label>
        <input type="file" accept=".pdf,.csv,.txt,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
      <button className="btn primary" disabled={busy} onClick={() => run(async () => {
        const form = new FormData();
        form.set("brokerId", brokerId); form.set("text", text); if (file) form.set("file", file);
        const r = await api<{ drafts: Omit<Draft, "keep">[] }>("/api/import/extract", { form });
        setDrafts(r.drafts.map((d) => ({ ...d, keep: true })));
        return r.drafts.length ? `Found ${r.drafts.length}. Check them below.` : "No transactions found in that.";
      })}>{busy ? "Reading" : "Read it"}</button>
      {view}
      {drafts.length > 0 && (
        <>
          <div className="tbl-wrap" style={{ marginTop: 14 }}><table className="t">
            <thead><tr><th>Keep</th><th>Type</th><th>Date</th><th>Ticker</th><th>Shares</th><th>Price</th><th>Fees</th><th>Amount ({broker.currency})</th><th>Sure</th></tr></thead>
            <tbody>{drafts.map((d, i) => (
              <tr key={i} style={{ opacity: d.keep ? 1 : 0.45 }}>
                <td><input type="checkbox" checked={d.keep} onChange={(e) => upd(i, "keep", e.target.checked)} /></td>
                <td><select value={d.type} onChange={(e) => upd(i, "type", e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></td>
                <td><input type="date" value={d.date} onChange={(e) => upd(i, "date", e.target.value)} /></td>
                <td><input value={d.ticker ?? ""} size={6} onChange={(e) => upd(i, "ticker", e.target.value)} /></td>
                <td><input type="number" value={d.qty ?? ""} style={{ width: 80 }} onChange={(e) => upd(i, "qty", e.target.value)} /></td>
                <td><input type="number" value={d.price ?? ""} style={{ width: 90 }} onChange={(e) => upd(i, "price", e.target.value)} /></td>
                <td><input type="number" value={d.fee ?? ""} style={{ width: 80 }} onChange={(e) => upd(i, "fee", e.target.value)} /></td>
                <td><input type="number" value={d.amount} style={{ width: 110 }} onChange={(e) => upd(i, "amount", e.target.value)} /></td>
                <td><span className={`pill ${d.confidence >= 0.8 ? "gain" : d.confidence >= 0.5 ? "warn" : "loss"}`}>{Math.round(d.confidence * 100)}%</span></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy} onClick={() => run(async () => {
              const keep = drafts.filter((d) => d.keep);
              await api("/api/transactions", { json: keep.map(({ keep: _k, confidence: _c, ...d }) => ({ ...d, brokerId })) });
              setDrafts([]); setText(""); setFile(null);
              return `Saved ${keep.length} transaction${keep.length === 1 ? "" : "s"}.`;
            })}>Save {drafts.filter((d) => d.keep).length} to ledger</button>
            <button className="btn" onClick={() => setDrafts([])}>Discard</button>
          </div>
        </>
      )}
    </Card>
  );
}

function ReviewRow({ t, broker }: { t: Tx; broker?: Broker }) {
  const [f, setF] = useState({ type: t.type, date: t.date, ticker: t.ticker ?? "", qty: t.qty ?? "", price: t.price ?? "", fee: t.fee ?? "", amount: t.amount });
  const { busy, run, view } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (v: string | number) => (v === "" ? null : Number(v));
  return (
    <div className="review" style={{ marginBottom: 10 }}>
      <b>{broker?.name}</b> <span className="src">{t.note} {t.confidence !== undefined && `(Claude ${Math.round(t.confidence * 100)}% sure)`}</span>
      <div className="form" style={{ marginTop: 8 }}>
        <div><label>Type</label><select value={f.type} onChange={set("type")}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label>Date</label><input type="date" value={f.date} onChange={set("date")} /></div>
        <div><label>Ticker</label><input value={f.ticker} onChange={set("ticker")} /></div>
        <div><label>Shares</label><input type="number" value={f.qty} onChange={set("qty")} /></div>
        <div><label>Price</label><input type="number" value={f.price} onChange={set("price")} /></div>
        <div><label>Fees</label><input type="number" value={f.fee} onChange={set("fee")} /></div>
        <div><label>Amount ({broker?.currency})</label><input type="number" value={f.amount} onChange={set("amount")} /></div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary small" disabled={busy} onClick={() => run(async () => {
          await api("/api/transactions", { method: "PATCH", json: { id: t.id, brokerId: t.brokerId, type: f.type, date: f.date, ticker: f.ticker || null,
            qty: num(f.qty), price: num(f.price), fee: num(f.fee), amount: num(f.amount), status: "confirmed" } });
        })}>Looks right, confirm</button>
        <button className="btn small danger" disabled={busy} onClick={() => run(async () => { await api(`/api/transactions?id=${t.id}`, { method: "DELETE" }); })}>Not a transaction, delete</button>
        <span className="src">{money(t.amount, t.currency)} as read</span>
      </div>
      {view}
    </div>
  );
}
