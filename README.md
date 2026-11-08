# Portfolio HQ

Private dashboard for tracking money, positions and market signals across PH and US stock brokers, with Claude-scored news and rule-based buy and sell suggestions.

Stack: Next.js on Vercel, Firestore and Firebase Auth, GitHub Actions for market-hours scans, Anthropic API.

Setup, architecture, rules and backlog are in [CLAUDE.md](./CLAUDE.md).

```
cp .env.example .env.local
npm install
npm run dev
```

## Deployment and CI/CD

- **Vercel project:** `ai-trading-system` (team `markravencanete50-1710s-projects`), linked to this repo.
- **CD:** every push to `main` deploys to production. Other branches and pull requests get preview deployments.
- **CI:** `.github/workflows/ci.yml` runs typecheck, unit tests and a production build on every push and pull request.
- **Market scans:** `.github/workflows/scan.yml` calls `/api/cron/scan` every 15 minutes during PSE and US sessions. It needs the `APP_URL` and `CRON_SECRET` repo secrets.
- **Daily job:** Vercel Cron calls `/api/cron/daily` at 22:00 UTC (6am Manila).

The app needs the env vars in `.env.example` set in Vercel (Production and Preview) before sign-in and data work. See CLAUDE.md, "Setup (first deploy)".
