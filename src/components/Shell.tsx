"use client";
import { signOut } from "firebase/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { fbAuth } from "@/lib/client/firebase";
import { useData } from "./DataProvider";

const NAV = [
  { href: "/", label: "Overview", short: "Overview", icon: <path d="M3 13h4v7H3zM10 8h4v12h-4zM17 4h4v16h-4z" /> },
  { href: "/positions", label: "Positions", short: "Positions", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></> },
  { href: "/suggestions", label: "Suggestions", short: "Ideas", icon: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />, badge: true },
  { href: "/money", label: "Money in and out", short: "Money", icon: <path d="M7 7h13l-3-3M17 17H4l3 3" /> },
  { href: "/scorecard", label: "Scorecard", short: "Score", icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  { href: "/brokers", label: "Brokers", short: "Brokers", icon: <path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M2 10l10-6 10 6z" />, review: true },
  { href: "/settings", label: "Settings", short: "Settings", icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></> },
];

function Icon({ children }: { children: ReactNode }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export function Shell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const path = usePathname();
  const { suggestions, txs, display, setDisplay, fx, settings, user } = useData();
  const open = suggestions.filter((s) => s.status === "open" && s.action !== "WATCH").length;
  const review = txs.filter((t) => t.status === "needs_review").length;
  const count = (n: { badge?: boolean; review?: boolean }) => (n.badge ? open : n.review ? review : 0);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="app">
      <aside className="side">
        <div className="logo">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="7" fill="var(--brand)" /><path d="M6 17l4.5-5 3.5 3 6-7" fill="none" stroke="var(--brand-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Portfolio HQ
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
              <Icon>{n.icon}</Icon>{n.label}{count(n) > 0 && <span className="count">{count(n)}</span>}
            </Link>
          ))}
        </nav>
        <div className="foot">
          FX $1 = ₱{fx.toFixed(2)}{settings.fxUpdatedAt ? `, updated ${settings.fxUpdatedAt.slice(0, 10)}` : ", manual rate"}
          <br /><button className="linkbtn" onClick={() => signOut(fbAuth())}>Sign out {user.email}</button>
        </div>
      </aside>
      <main>
        <div className="top">
          <h1>{title}</h1>
          {actions}
          <div className="toggle" role="group" aria-label="Display currency">
            {(["PHP", "USD"] as const).map((c) => (
              <button key={c} aria-pressed={display === c} onClick={() => setDisplay(c)}>{c === "PHP" ? "₱ PHP" : "$ USD"}</button>
            ))}
          </div>
        </div>
        <div className="view">{children}</div>
      </main>
      <nav className="tabbar">
        {NAV.filter((n) => n.href !== "/settings").map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
            <Icon>{n.icon}</Icon>{n.short}{count(n) > 0 && <span className="count">{count(n)}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
