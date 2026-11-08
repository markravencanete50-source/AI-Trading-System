"use client";
import { useState } from "react";
import { api } from "@/lib/client/firebase";
import { today } from "@/lib/format";
import type { Broker, TxType } from "@/lib/types";
import { useAction } from "./ui";

const LABEL: Record<TxType, string> = {
  deposit: "Bank transfer in", withdrawal: "Bank transfer out", buy: "Buy", sell: "Sell",
  dividend: "Dividend", fee: "Fee", interest: "Interest",
};

export function TxForm({ brokers, types }: { brokers: Broker[]; types: TxType[] }) {
  const [f, setF] = useState({ brokerId: brokers[0]?.id ?? "", type: types[0], date: today(), ticker: "", qty: "", price: "", fee: "", amount: "", note: "" });
  const { busy, run, view } = useAction();
  const trade = f.type === "buy" || f.type === "sell";
  const broker = brokers.find((b) => b.id === f.brokerId);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v === "" ? null : Number(v));

  const submit = () => run(async () => {
    await api("/api/transactions", { json: {
      brokerId: f.brokerId, type: f.type, date: f.date, ticker: f.ticker || null, qty: n(f.qty), price: n(f.price),
      fee: n(f.fee), amount: trade ? null : n(f.amount), note: f.note,
    } });
    setF({ ...f, ticker: "", qty: "", price: "", fee: "", amount: "", note: "" });
    return `Saved ${LABEL[f.type].toLowerCase()}.`;
  });

  if (!brokers.length) return <p className="muted">Add a broker first.</p>;
  return (
    <div>
      <div className="form">
        <div><label>Broker</label><select value={f.brokerId} onChange={set("brokerId")}>{brokers.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select></div>
        {types.length > 1 && <div><label>Type</label><select value={f.type} onChange={set("type")}>{types.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select></div>}
        <div><label>Date</label><input type="date" value={f.date} onChange={set("date")} /></div>
        {(trade || f.type === "dividend") && <div><label>Ticker</label><input value={f.ticker} onChange={set("ticker")} placeholder={broker?.market === "US" ? "AAPL" : "JFC"} /></div>}
        {trade && <div><label>Shares</label><input type="number" value={f.qty} onChange={set("qty")} /></div>}
        {trade && <div><label>Price per share</label><input type="number" step="0.0001" value={f.price} onChange={set("price")} /></div>}
        {trade && <div><label>Total fees and taxes</label><input type="number" step="0.01" value={f.fee} onChange={set("fee")} /></div>}
        {!trade && <div><label>Amount ({broker?.currency})</label><input type="number" step="0.01" value={f.amount} onChange={set("amount")} /></div>}
        <div><label>Note</label><input value={f.note} onChange={set("note")} placeholder={f.type === "deposit" ? "From BPI savings" : ""} /></div>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "Saving" : "Save"}</button>
      </div>
      {trade && <p className="hint">The cash effect is worked out for you: shares x price, plus fees on a buy or minus fees on a sell.</p>}
      {view}
    </div>
  );
}
