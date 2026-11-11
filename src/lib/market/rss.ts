import "server-only";
import { safeFeedUrl } from "../server/urls";
import type { NewsItem } from "./types";

const clean = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&#8211;|&#8212;/g, "-").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
};
const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1];

/** PH business news matched to tickers by company-name aliases. */
export async function phNews(aliases: Record<string, string[]>, feeds: string[], since: Date): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  for (const url of feeds) {
    if (!safeFeedUrl(url)) { console.warn(`Skipped unsafe feed ${url}`); continue; }
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = (await res.text()).slice(0, 3_000_000);
      for (const it of xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []) {
        const pub = Date.parse(clean(tag(it, "pubDate")));
        if (!pub || pub < since.getTime()) continue;
        const title = clean(tag(it, "title"));
        const summary = clean(tag(it, "description")).slice(0, 400);
        const text = `${title} ${summary}`.toLowerCase();
        for (const [ticker, names] of Object.entries(aliases)) {
          if (names.some((n) => n && text.includes(n.toLowerCase()))) {
            items.push({ market: "PH", ticker, headline: title, summary, url: clean(tag(it, "link")), publishedAt: new Date(pub).toISOString() });
          }
        }
      }
    } catch (e) {
      console.error(`RSS failed: ${url}`, e);
    }
  }
  return items;
}
