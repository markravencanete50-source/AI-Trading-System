import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  watchlist: {
    US: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AMD", "JPM", "COST", "VOO"],
    PH: {
      JFC: ["Jollibee"], ALI: ["Ayala Land"], AC: ["Ayala Corp"], SM: ["SM Investments"],
      SMPH: ["SM Prime"], BDO: ["BDO Unibank"], BPI: ["Bank of the Philippine Islands"],
      TEL: ["PLDT"], GLO: ["Globe Telecom"], ICT: ["ICTSI", "International Container Terminal"],
      MER: ["Meralco", "Manila Electric"], URC: ["Universal Robina"],
    },
  },
  phFeeds: [
    "https://www.bworldonline.com/feed/",
    "https://business.inquirer.net/feed",
    "https://www.philstar.com/rss/business",
  ],
  riskPerTrade: 0.01,
  maxPositionPct: 0.25,
  newsThreshold: 2.5,
  newsHalfLifeH: 24,
  cooldownH: 24,
  buyTtlH: 6,
  maxSlippagePct: 0.015,
  maxScoredPerDay: 400,
  defaultBroker: { PH: null, US: null },
  fxUsdPhp: 57.8,
  fxUpdatedAt: null,
  alertEmail: "",
};

export function mergeSettings(saved: Partial<Settings> | undefined): Settings {
  const s = saved ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    watchlist: { ...DEFAULT_SETTINGS.watchlist, ...(s.watchlist ?? {}) },
    defaultBroker: { ...DEFAULT_SETTINGS.defaultBroker, ...(s.defaultBroker ?? {}) },
  };
}
