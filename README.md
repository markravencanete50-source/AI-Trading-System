# Portfolio HQ

Private dashboard for tracking money, positions and market signals across PH and US stock brokers, with Claude-scored news and rule-based buy and sell suggestions.

Stack: Next.js on Vercel, Firestore and Firebase Auth, GitHub Actions for market-hours scans, Anthropic API.

Setup, architecture, rules and backlog are in [CLAUDE.md](./CLAUDE.md).

```
cp .env.example .env.local
npm install
npm run dev
```
