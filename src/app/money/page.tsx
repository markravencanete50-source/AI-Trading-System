"use client";
import { useState } from "react";
import { useData } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { TxForm } from "@/components/TxForm";
import { BrokerTag, Card, Kpi, useAction } from "@/components/ui";
import { api } from "@/lib/client/firebase";
import { disp, money, signed } from "@/lib/format";
import type { TxType } from "@/lib/types";

const FILTERS: (TxType | "all")[] = ["all", "deposit", "withdrawal", "buy", "sell", "dividend", "fee"];
const NAME: Record<string, string> = { all: "All", deposit: "Deposits", withdrawal: "Withdrawals", buy: "Buys", sell: "Sells", dividend: "Dividends", fee: "Fees" };

export default function Money() {
  const { txs, brokers, display, fx } = useData();
  const [filter, setFilter] = useState<TxType | "all">("all");
  const { run, view } = useAction();
  const d = (v: number, dec?: number) => disp(v, display, fx, dec);
  const year = new Date().getFullYear().toString();
  const confirmed = txs.filter((t) => t.status === "confirmed");
  const sum = (type: TxType) => confirmed.filter((t) => t.type === type && t.date.startsWith(year)).reduce((a, t) => a + t.amount * (t.fxToPhp || 1), 0);
  const tin = sum("deposit"), tout = -sum("withdrawal"), div = sum("dividend"), fees = -sum("fee");
  const rows = confirmed.filter((t) => filter === "all" || t.type === filter);
  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const names = new Map(brokers.map((b) => [b.id, b.name]));
    const head = ["date", "broker", "type", "ticker", "qty", "price", "fee", "amount", "currency", "fxToPhp", "source", "note"];
    const lines = rows.map((t) => [t.date, names.get(t.brokerId), t.type, t.ticker, t.qty, t.price, t.fee, t.amount, t.currency, t.fxToPhp, t.source, t.note].map(q).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Shell title="Money in and out">
      <div className="stack">
        <div className="grid g3">
          <Kpi k={`Deposited in ${year}`} n={d(tin, 0)} s="Bank transfers into your brokers" />
          <Kpi k={`Withdrawn in ${year}`} n={d(tout, 0)} s={`Net in: ${d(tin - tout, 0)}`} />
          <Kpi k={`Dividends in ${year}`} n={d(div, 0)} s={`Standalone fees: ${d(fees, 0)}`} />
        </div>
        <Card title="Record a bank transfer" sub="You move money from your bank to the broker yourself. Log it here so cash and returns stay accurate.">
          <TxForm brokers={brokers} types={["deposit", "withdrawal"]} />
        </Card>
        <Card title="Log a trade, dividend or fee" sub="For brokers without an API. Alpaca fills arrive on their own when you sync.">
          <TxForm brokers={brokers} types={["buy", "sell", "dividend", "fee", "interest"]} />
        </Card>
        <Card title="Ledger" sub="Every movement. Positions and P&L are calculated from this list.">
          <div className="chips">{FILTERS.map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{NAME[f]}</button>)}
            <button onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button></div>
          {view}
          {rows.length === 0 ? <div className="empty">Nothing here yet.</div> : (
            <div className="tbl-wrap"><table className="t">
              <thead><tr><th>Date</th><th>Broker</th><th>Type</th><th>Details</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>{rows.map((t) => {
                const php = t.amount * (t.fxToPhp || 1);
                const detail = t.ticker && t.qty ? `${t.qty} ${t.ticker} @ ${money(t.price ?? 0, t.currency)}${t.fee ? `, fees ${money(t.fee, t.currency)}` : ""}` : t.ticker ?? "";
                return (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td><BrokerTag broker={brokers.find((b) => b.id === t.brokerId)} /></td>
                    <td>{t.type}<br /><span className="src">{t.source}</span></td>
                    <td>{detail}{t.note ? <><br /><span className="src">{t.note}</span></> : null}</td>
                    <td className={`r ${php >= 0 ? "up" : "down"}`}><b>{signed(d(php, 2), php)}</b>{t.currency !== display && <><br /><span className="src">{money(t.amount, t.currency)}</span></>}</td>
                    <td className="r">{t.source !== "alpaca" && (
                      <button className="btn small danger" onClick={() => confirm("Delete this transaction?") && run(async () => { await api(`/api/transactions?id=${t.id}`, { method: "DELETE" }); })}>Delete</button>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
