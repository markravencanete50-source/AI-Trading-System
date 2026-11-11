"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/firebase";
import { Card } from "./ui";

interface Health {
  config: Record<"firebaseAdmin" | "anthropic" | "cronSecret" | "webhookSecret" | "alpaca" | "email", boolean> & { alpacaPaper: boolean };
  lastPriceUpdate: string | null;
  lastSnapshot: string | null;
}

const ROWS: [keyof Health["config"], string, string][] = [
  ["firebaseAdmin", "Database access", "Needed to save anything"],
  ["anthropic", "Claude (news scoring)", "Needed for suggestions and statement import"],
  ["cronSecret", "Scan secret", "Needed for the 15-minute scans and the daily job"],
  ["alpaca", "Alpaca keys", "Needed for US prices and US scans"],
  ["email", "Email alerts", "Optional"],
  ["webhookSecret", "Email import secret", "Optional, for Make.com"],
];

/** Owner-only setup check so a missing key shows up here instead of as a silent failure. */
export function Status() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<Health>("/api/health").then(setH).catch((e) => setErr(e.message)); }, []);
  return (
    <Card title="System status" sub="Which connections are set up on the server. Values are never shown.">
      {err && <p className="error">{err}</p>}
      {!h && !err && <p className="muted">Checking</p>}
      {h && (
        <>
          <div className="caps">
            {ROWS.map(([k, label, why]) => (
              <span key={k} className={`cap ${h.config[k] ? "yes" : ""}`} title={why}>{label}: {h.config[k] ? "ready" : "missing"}</span>
            ))}
          </div>
          <p className="hint">
            Alpaca mode: {h.config.alpacaPaper ? "paper (no real money)" : "LIVE (real money)"}. Last price update: {h.lastPriceUpdate ? h.lastPriceUpdate.slice(0, 16).replace("T", " ") + " UTC" : "never"}. Last daily snapshot: {h.lastSnapshot ?? "never"}.
          </p>
        </>
      )}
    </Card>
  );
}
