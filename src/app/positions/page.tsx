"use client";
import { useData } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { BrokerTag, Card, Kpi } from "@/components/ui";
import { disp, money, pct, signed } from "@/lib/format";
import { toPhp } from "@/lib/money";

const PILL = { BUY: "gain", SELL: "loss", TRIM: "warn", WATCH: "warn" } as const;

export default function Positions() {
  const { val, brokers, suggestions, display, fx, portfolio } = useData();
  const d = (v: number, dec?: number) => disp(v, display, fx, dec);
  const signalFor = (brokerId: string, ticker: string) =>
    suggestions.find((s) => s.status === "open" && s.ticker === ticker && s.brokerId === brokerId);
  const pnl = val.holdingsPhp - val.costPhp;
  const cur = new Map(brokers.map((b) => [b.id, b.currency]));
  const realizedPhp = portfolio.positions.reduce((a, p) => a + toPhp(p.realized, cur.get(p.brokerId) ?? "PHP", fx), 0);

  return (
    <Shell title="Positions">
      <div className="stack">
      <div className="grid g3">
        <Kpi k="Unrealised P&L" n={signed(d(pnl, 0), pnl)} s="Open positions against their cost" />
        <Kpi k="Realised P&L" n={signed(d(realizedPhp, 0), realizedPhp)} s="Booked from sells, fees included" />
        <Kpi k="Holdings value" n={d(val.holdingsPhp, 0)} s={`${val.rows.length} position${val.rows.length === 1 ? "" : "s"}`} />
      </div>
      <Card title="Everything you hold" sub="Calculated from your ledger. Prices refresh during market scans and once a day.">
        {val.rows.length === 0 ? <div className="empty">No holdings yet. Log a buy on the Money page or import a statement on Brokers.</div> : (
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>Stock</th><th>Broker</th><th className="r">Shares</th><th className="r">Avg cost</th><th className="r">Value</th><th className="r">Unrealised P&amp;L</th><th className="r">Signal</th></tr></thead>
              <tbody>
                {val.rows.map((r) => {
                  const sig = signalFor(r.brokerId, r.ticker);
                  return (
                    <tr key={`${r.brokerId}|${r.ticker}`}>
                      <td className="tk">{r.ticker}<span className={`mkt ${r.market}`}>{r.market}</span>
                        <small>{r.stop ? `Stop ${money(r.stop, r.currency)}` : "No stop set"}{!r.priced && ", price not loaded yet"}</small></td>
                      <td><BrokerTag broker={brokers.find((b) => b.id === r.brokerId)} /></td>
                      <td className="r">{r.qty.toLocaleString()}</td>
                      <td className="r">{money(r.avgCost, r.currency)}<br /><span className="src">now {money(r.last, r.currency)}</span></td>
                      <td className="r"><b>{d(r.valuePhp, 0)}</b><br /><span className="src">{(r.weight * 100).toFixed(1)}% of total</span></td>
                      <td className={`r ${r.pnl >= 0 ? "up" : "down"}`}><b>{signed(d(r.pnlPhp, 0), r.pnlPhp)}</b><br />{pct(r.pnlPct)}</td>
                      <td className="r">{sig ? <span className={`pill ${PILL[sig.action]}`}>{sig.action}</span> : <span className="pill neutral">HOLD</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>Total holdings</td><td /><td /><td /><td className="r">{d(val.holdingsPhp, 0)}</td><td className={`r ${pnl >= 0 ? "up" : "down"}`}>{signed(d(pnl, 0), pnl)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
      </div>
    </Shell>
  );
}
