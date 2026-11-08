import type { Market } from "../types";

/** Rough session window incl. a short pre-open. Holidays are not handled; scans then just find nothing new. */
export function marketOpen(market: Market, now = new Date()) {
  const tz = market === "PH" ? "Asia/Manila" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return market === "PH" ? mins >= 9 * 60 && mins <= 15 * 60 + 15 : mins >= 8 * 60 + 30 && mins <= 16 * 60 + 15;
}
