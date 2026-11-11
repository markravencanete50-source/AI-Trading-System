"use client";
import { useEffect, useState } from "react";
import { useData } from "@/components/DataProvider";
import { Shell } from "@/components/Shell";
import { Card, useAction } from "@/components/ui";
import { Status } from "@/components/Status";
import { api } from "@/lib/client/firebase";

export default function SettingsPage() {
  const { settings, brokers } = useData();
  const [us, setUs] = useState("");
  const [ph, setPh] = useState("");
  const [feeds, setFeeds] = useState("");
  const [n, setN] = useState({ riskPerTrade: 0, maxPositionPct: 0, newsThreshold: 0, buyTtlH: 0, maxScoredPerDay: 0, fxUsdPhp: 0 });
  const [defaults, setDefaults] = useState(settings.defaultBroker);
  const [alertEmail, setAlertEmail] = useState("");
  const { busy, run, view } = useAction();

  useEffect(() => {
    setUs(settings.watchlist.US.join(", "));
    setPh(Object.entries(settings.watchlist.PH).map(([t, a]) => `${t}: ${a.join(", ")}`).join("\n"));
    setFeeds(settings.phFeeds.join("\n"));
    setN({ riskPerTrade: settings.riskPerTrade * 100, maxPositionPct: settings.maxPositionPct * 100, newsThreshold: settings.newsThreshold, buyTtlH: settings.buyTtlH, maxScoredPerDay: settings.maxScoredPerDay, fxUsdPhp: settings.fxUsdPhp });
    setDefaults(settings.defaultBroker);
    setAlertEmail(settings.alertEmail);
  }, [settings]);

  const save = () => run(async () => {
    const phMap: Record<string, string[]> = {};
    for (const line of ph.split("\n")) {
      const [t, rest = ""] = line.split(":");
      if (t.trim()) phMap[t.trim().toUpperCase()] = rest.split(",").map((s) => s.trim()).filter(Boolean);
    }
    await api("/api/settings", { method: "PUT", json: {
      watchlist: { US: us.split(/[,\s]+/).filter(Boolean), PH: phMap },
      phFeeds: feeds.split("\n").map((s) => s.trim()).filter(Boolean),
      riskPerTrade: n.riskPerTrade / 100, maxPositionPct: n.maxPositionPct / 100, newsThreshold: n.newsThreshold,
      buyTtlH: n.buyTtlH, maxScoredPerDay: n.maxScoredPerDay, fxUsdPhp: n.fxUsdPhp, defaultBroker: defaults, alertEmail,
    } });
    return "Settings saved.";
  });
  const num = (k: keyof typeof n) => ({ type: "number", step: "any", value: n[k], onChange: (e: { target: { value: string } }) => setN({ ...n, [k]: Number(e.target.value) }) });

  return (
    <Shell title="Settings">
      <div className="stack">
        <Card title="Watchlist" sub="Stocks scanned for new buy ideas. Anything you already hold is always scanned for sell and trim signals.">
          <div className="field"><label>US tickers</label><input value={us} onChange={(e) => setUs(e.target.value)} /></div>
          <div className="field"><label>PH tickers, one per line, with names used to match news</label><textarea value={ph} onChange={(e) => setPh(e.target.value)} /><p className="hint">Example: JFC: Jollibee, Jollibee Foods</p></div>
          <div className="field"><label>PH news feeds (RSS), one per line</label><textarea value={feeds} onChange={(e) => setFeeds(e.target.value)} style={{ minHeight: 80 }} /></div>
        </Card>
        <Card title="Risk" sub="Sizing uses your whole net worth. A stop-out on one trade loses about the risk percentage.">
          <div className="form">
            <div><label>Risk per trade (%)</label><input {...num("riskPerTrade")} /></div>
            <div><label>Max position size (%)</label><input {...num("maxPositionPct")} /></div>
            <div><label>News score needed</label><input {...num("newsThreshold")} /></div>
            <div><label>Buy ideas expire after (hours)</label><input {...num("buyTtlH")} /></div>
            <div><label>Max headlines sent to Claude per day</label><input {...num("maxScoredPerDay")} /></div>
            <div><label>USD to PHP (auto-updated daily)</label><input {...num("fxUsdPhp")} /></div>
          </div>
        </Card>
        <Card title="Defaults and alerts">
          <div className="form">
            {(["PH", "US"] as const).map((m) => (
              <div key={m}><label>Default broker for {m} buys</label>
                <select value={defaults[m] ?? ""} onChange={(e) => setDefaults({ ...defaults, [m]: e.target.value || null })}>
                  <option value="">First {m} broker</option>
                  {brokers.filter((b) => b.market === m).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
            ))}
            <div><label>Email alerts to</label><input type="email" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} placeholder="Leave empty for no emails" /></div>
          </div>
        </Card>
        <Status />
        <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving" : "Save settings"}</button>{view}</div>
      </div>
    </Shell>
  );
}
