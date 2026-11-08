"use client";
import { PairBars } from "@/components/charts";
import { useData } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { Card, Kpi } from "@/components/ui";

const H = [["d5", "5 days"], ["d20", "20 days"], ["d60", "60 days"]] as const;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const p = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export default function Scorecard() {
  const { suggestions } = useData();
  const buys = suggestions.filter((s) => s.action === "BUY" && s.outcome);
  const sells = suggestions.filter((s) => s.action === "SELL" && s.outcome);
  const graded = buys.length + sells.length;
  const at = (list: typeof buys, k: (typeof H)[number][0]) => list.map((s) => s.outcome?.[k]).filter(Boolean) as { ret: number; bench: number }[];
  const b20 = at(buys, "d20");
  const s20 = at(sells, "d20");
  const groups = H.map(([k, label]) => { const o = at(buys, k); return { x: `After ${label}`, a: avg(o.map((x) => x.ret)), b: avg(o.map((x) => x.bench)), n: o.length }; });

  return (
    <Shell title="Scorecard">
      <div className="stack">
        <div className="grid g3">
          <Kpi k="Suggestions graded" n={graded} s={`${buys.length} buys, ${sells.length} sells. Every signal counts, taken or not.`} />
          <Kpi k="Buys up after 20 days" n={b20.length ? `${Math.round((b20.filter((o) => o.ret > 0).length / b20.length) * 100)}%` : "None yet"} s={`${b20.length} graded at 20 days`} />
          <Kpi k="Move after sell signals" n={s20.length ? p(avg(s20.map((o) => o.ret))) : "None yet"} s="Negative means the sell avoided a further drop" />
        </div>
        <Card title="Buy suggestions vs just holding the index" sub="Average return after each period. Benchmark: FMETF for PH ideas, SPY for US ideas.">
          {buys.length === 0 ? <div className="empty">Grades appear 5, 20 and 60 trading days after each buy suggestion.</div> : (
            <PairBars label="Average return of buy suggestions vs benchmark" groups={groups}
              a={{ name: "Suggestions", color: "var(--brand)" }} b={{ name: "Index", color: "var(--muted)" }}
              fmt={(v) => p(v)} />
          )}
          <p className="sub" style={{ marginTop: 10 }}>{graded < 50 ? `${graded} graded so far. Treat this as a trend to watch until there are at least 50.` : "Enough grades to start trusting the trend."}</p>
        </Card>
      </div>
    </Shell>
  );
}
