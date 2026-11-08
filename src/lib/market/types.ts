export interface Bar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsItem {
  market: "PH" | "US";
  ticker: string;
  headline: string;
  summary: string;
  url: string;
  publishedAt: string; // ISO UTC
}
