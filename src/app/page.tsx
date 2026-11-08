"use client";
import Link from "next/link";
import { LineChart, PairBars } from "@/components/charts";
import { useData } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { disp, short, signed } from "@/lib/format";
import { flowsByMonth, lastMonths } from "@/lib/money";

const MONTH = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });

export default function Overview() {
  const { brokers, txs, snapshots, val, display, fx } = useData();
  const d = (v: number, dec?: number) => disp(v, display, fx, dec);
  const s = (v: number) => short(v, display, fx);

  if (!brokers.length) {
    return (
      <Shell title="Overview">
        <Card title="Start by adding a broker">
          <p className="muted">Add each account you hold stocks in, then record the bank transfers you made into it. Everything else builds from there.</p>
          <Link className="btn primary" href="/brokers">Add a broker</Link>
        </Card>
      </Shell>
    );
  }

  // Month-end net worth from snapshots, plus today's live value.
  const months = lastMonths(6);
  const monthEnds = months.map((m) => {
    const inMonth = snapshots.filter((x) => x.date.startsWith(m));
    return inMonth.length ? { m, v: inMonth[inMonth.length - 1].totalPhp } : null;
  }).filter(Boolean) as { m: string; v: number }[];
  const points = [...monthEnds.filter((x) => x.m !== months[months.length - 1]), { m: months[months.length - 1], v: val.totalPhp }]
    .map((x) => ({ x: MONTH(x.m), y: x.v, tag: s(x.v) }));

  const start = monthEnds[0];
  const flows = flowsByMonth(txs, months);
  const after = start ? flows.filter((f) => f.month > start.m) : [];
  const netDeposits = after.reduce((a, f) => a + f.inPhp - f.outPhp, 0);
  const change = start ? val.totalPhp - start.v : 0;
  const market = change - netDeposits;
  const tin = flows.reduce((a, f) => a + f.inPhp, 0), tout = flows.reduce((a, f) => a + f.outPhp, 0);

  return (
    <Shell title="Overview">
      <div className="stack">
        <div className="hero">
          <Card className="worth">
            <div className="label">Net worth across {brokers.length} broker{brokers.length > 1 ? "s" : ""}</div>
            <div className="big num">{d(val.totalPhp, 0)}</div>
            {start && <span className={`pill ${change >= 0 ? "gain" : "loss"}`}>{signed(d(change, 0), change)} since end of {MONTH(start.m)}</span>}
            <div className="split">
              {start && <div>From your deposits<b>{d(netDeposits, 0)}</b></div>}
              {start && <div>From the markets<b className={market >= 0 ? "up" : "down"}>{signed(d(market, 0), market)}</b></div>}
              <div>Cash not invested<b>{d(val.cashPhp, 0)}</b></div>
            </div>
          </Card>
          <Card title="Where it sits" sub="Holdings plus cash at each broker">
            {brokers.map((b, i) => {
              const v = val.byBroker[b.id]?.totalPhp ?? 0;
              const p = val.totalPhp > 0 ? (v / val.totalPhp) * 100 : 0;
              return (
                <div className="alloc-row" key={b.id}>
                  <div className="nm">{b.name}<small>{b.market} stocks, {b.currency}</small></div>
                  <div className="bar"><span className="growx" style={{ width: `${Math.max(0, p).toFixed(1)}%`, background: b.market === "US" ? "var(--us)" : "var(--brand)", animationDelay: `${0.15 + i * 0.12}s` }} /></div>
                  <div className="val">{s(v)}<small>{p.toFixed(0)}%</small></div>
                </div>
              );
            })}
          </Card>
        </div>
        <div className="grid g2">
          <Card title="Net worth, last 6 months" sub="End-of-month value, today for this month">
            <LineChart points={points} label="Net worth by month" />
          </Card>
          <Card title="Money in and out" sub={`Bank transfers into and out of your brokers. In ${s(tin)}, out ${s(tout)}.`}>
            <PairBars label="Deposits and withdrawals by month"
              groups={flows.map((f) => ({ x: MONTH(f.month), a: f.inPhp, b: f.outPhp }))}
              a={{ name: "In", color: "var(--gain)" }} b={{ name: "Out", color: "var(--loss)" }}
              fmt={(v, narrow) => narrow ? short(v, display, fx, false) : s(v)} />
          </Card>
        </div>
      </div>
    </Shell>
  );
}
