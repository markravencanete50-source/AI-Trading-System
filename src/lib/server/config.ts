import "server-only";

const env = (k: string, d = "") => process.env[k] ?? d;

export const cfg = {
  ownerEmail: env("OWNER_EMAIL").toLowerCase(),
  appUrl: env("APP_URL", "http://localhost:3000").replace(/\/$/, ""),
  cronSecret: env("CRON_SECRET"),
  webhookSecret: env("WEBHOOK_SECRET"),
  anthropicKey: env("ANTHROPIC_API_KEY"),
  aiModel: env("AI_MODEL", "claude-haiku-5-5"),
  alpaca: {
    keyId: env("ALPACA_KEY_ID"),
    secret: env("ALPACA_SECRET_KEY"),
    paper: env("ALPACA_PAPER", "true").toLowerCase() !== "false",
    feed: env("ALPACA_FEED", "iex"),
    get tradingUrl() {
      return this.paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
    },
    dataUrl: "https://data.alpaca.markets",
  },
  smtp: {
    host: env("SMTP_HOST", "smtp.gmail.com"),
    port: Number(env("SMTP_PORT", "587")),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
  },
};
