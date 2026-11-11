import "server-only";
// PSE prices and disclosures from PSE EDGE. These endpoints are undocumented (they back the
// public charts). If PH scans start failing, check here first.
import { col } from "../server/db";
import type { Bar, NewsItem } from "./types";

const EDGE = "https://edge.pse.com.ph";
const UA = { "user-agent": "Mozilla/5.0 (portfolio-hq personal research)" };
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const ROUTINE = [
  "change in shareholdings", "changes in shareholdings", "beneficial ownership", "public ownership report",
  "top 100 stockholders", "foreign ownership", "list of stockholders", "issued and/or outstanding shares",
  "certification", "notice of annual", "[amend", "amended",
];
const T = () => AbortSignal.timeout(20_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const mdY = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
const manila = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3); // shifted clock for date parts

export interface PseIds { cmpyId: string; securityId: string; name: string }

export async function ids(ticker: string): Promise<PseIds> {
  const ref = col.pseIds().doc(ticker);
  const cached = await ref.get();
  if (cached.exists) return cached.data() as PseIds;
  const r = await fetch(`${EDGE}/autoComplete/searchCompanyNameSymbol.ax?term=${encodeURIComponent(ticker)}`, { headers: UA, signal: T() });
  const list = (await r.json()) as { cmpyId: string; cmpyNm: string; symbol: string }[];
  const m = list.find((x) => x.symbol === ticker);
  if (!m) throw new Error(`${ticker} not found on PSE EDGE`);
  const page = await (await fetch(`${EDGE}/companyPage/stockData.do?cmpy_id=${m.cmpyId}`, { headers: UA, signal: T() })).text();
  const opts = [...page.matchAll(/<option[^>]*value="(\d+)"[^>]*>\s*([^<]+?)\s*<\/option>/g)];
  const sec = opts.find((o) => o[2] === ticker)?.[1] ?? opts[0]?.[1];
  if (!sec) throw new Error(`No security id for ${ticker}`);
  const out = { cmpyId: m.cmpyId, securityId: sec, name: decode(m.cmpyNm) };
  await ref.set(out);
  return out;
}

export async function bars(tickers: string[], days = 270): Promise<Record<string, Bar[]>> {
  const end = manila();
  const start = new Date(end.getTime() - days * 864e5);
  const out: Record<string, Bar[]> = {};
  for (const t of tickers) {
    try {
      const { cmpyId, securityId } = await ids(t);
      const r = await fetch(`${EDGE}/common/DisclosureCht.ax`, {
        method: "POST", headers: { ...UA, "content-type": "application/json" }, signal: T(),
        body: JSON.stringify({ cmpy_id: cmpyId, security_id: securityId, startDate: mdY(start), endDate: mdY(end) }),
      });
      const j = (await r.json()) as { chartData?: { OPEN: number; HIGH: number; LOW: number; CLOSE: number; VALUE: number; CHART_DATE: string }[] };
      out[t] = (j.chartData ?? []).map((b) => {
        const [mon, day, year] = b.CHART_DATE.replace(",", "").split(" ");
        const date = `${year}-${String(MONTHS[mon] + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
        // VALUE is peso turnover, not shares. Only its ratio to its own average is used.
        return { date, open: b.OPEN, high: b.HIGH, low: b.LOW, close: b.CLOSE, volume: b.VALUE };
      }).filter((b) => b.close > 0).sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
      console.error(`PSE bars failed for ${t}`, e);
    }
    await sleep(300);
  }
  return out;
}

export async function disclosures(tickers: string[], since: Date): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  const q = (d: Date) => mdY(manila(d));
  for (const t of tickers) {
    try {
      const { cmpyId } = await ids(t);
      const url = `${EDGE}/companyDisclosures/search.ax?keyword=${cmpyId}&tmplNm=&fromDate=${q(since)}&toDate=${q(new Date())}&sortType=date&dateSortType=DESC`;
      const html = await (await fetch(url, { headers: UA, signal: T() })).text();
      for (const row of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1].replace(/<[^>]+>/g, "")).trim());
        const edge = row.match(/openPopup\('([^']+)'\)/)?.[1];
        if (cells.length < 2 || !edge) continue;
        const title = cells[0];
        if (ROUTINE.some((k) => title.toLowerCase().includes(k))) continue;
        const m = cells[1].match(/(\w{3}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)/);
        if (!m) continue;
        let h = Number(m[4]) % 12;
        if (m[6] === "PM") h += 12;
        const ts = new Date(Date.UTC(Number(m[3]), MONTHS[m[1]], Number(m[2]), h - 8, Number(m[5])));
        if (ts < since) continue;
        items.push({
          market: "PH", ticker: t, headline: `PSE disclosure: ${title}`, summary: "Official filing on PSE EDGE.",
          url: `${EDGE}/openDiscViewer.do?edge_no=${edge}`, publishedAt: ts.toISOString(),
        });
      }
    } catch (e) {
      console.error(`PSE disclosures failed for ${t}`, e);
    }
    await sleep(300);
  }
  return items;
}
