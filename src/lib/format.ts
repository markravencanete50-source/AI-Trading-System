import type { Currency } from "./types";

export type DisplayCurrency = "PHP" | "USD";

const SYM: Record<Currency, string> = { PHP: "₱", USD: "$" };

export function money(v: number, cur: Currency, decimals?: number) {
  const d = decimals ?? (Math.abs(v) >= 10000 ? 0 : 2);
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${v < 0 ? "-" : ""}${SYM[cur]}${s}`;
}

/** Format a PHP amount in the chosen display currency. */
export function disp(vPhp: number, display: DisplayCurrency, fx: number, decimals?: number) {
  return money(display === "PHP" ? vPhp : vPhp / fx, display, decimals);
}

export function short(vPhp: number, display: DisplayCurrency, fx: number, withSymbol = true) {
  const v = display === "PHP" ? vPhp : vPhp / fx;
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1000 ? (a / 1000).toFixed(a >= 100000 ? 0 : 1).replace(/\.0$/, "") + "k" : a.toFixed(0);
  return `${v < 0 ? "-" : ""}${withSymbol ? SYM[display] : ""}${s}`;
}

export const signed = (s: string, v: number) => (v > 0 ? "+" + s : s);
export const pct = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
export const today = () => new Date().toISOString().slice(0, 10);
