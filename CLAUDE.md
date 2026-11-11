# Portfolio HQ: handover for Claude Code

Read this file first. It is the source of truth for how this repo works and what to build next.

## What this is

A private, single-user web app for Mark (Lee) that sits above all his stock brokers:

- One ledger of every peso and dollar: bank transfers in and out, buys, sells, dividends, fees.
- Positions, P&L and net worth calculated from that ledger, across PH (PSE) and US brokers, in PHP or USD.
- Market data, news and official PSE disclosures scored by Claude Haiku, combined with fixed technical and risk rules into BUY, SELL, TRIM and WATCH suggestions.
- Brokers with an API (Alpaca) sync automatically and can execute an approved suggestion. Brokers without an API (most PH brokers: COL Financial, BPI Trade, First Metro, Philstocks) get suggestions too; Mark places the order himself and logs it.
- A scorecard that grades every BUY and SELL suggestion after 5, 20 and 60 trading days against an index, so he can see whether the suggestions are worth following.

Money moves between Mark's bank and his brokers manually. The app never touches a bank. Bank transfers are recorded as deposit and withdrawal transactions (logged by hand, or synced from Alpaca where Alpaca reports them).

## Stack

| Layer | Choice |
|---|---|
| App and API | Next.js 15 App Router, TypeScript, React 19 |
| Hosting | Vercel (region sin1, closest to the Philippines) |
| Database | Firestore (Firebase), Admin SDK on the server |
| Auth | Firebase Auth, Google sign-in, one owner email |
| AI | Anthropic API, Claude Haiku (`AI_MODEL`, default `claude-haiku-5-5`) |
| Repo and scheduler | GitHub, plus GitHub Actions for the 15-minute market scans |
| US market data and execution | Alpaca REST API (paper by default) |
| PH market data | PSE EDGE (undocumented endpoints) plus business news RSS |
| Email alerts | Gmail SMTP through nodemailer |

## Commands

```
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm test             # unit tests for the money math (node --test)
npm run build
```

Trigger jobs locally:

```
curl -X POST "http://localhost:3000/api/cron/scan?market=PH&force=1" -H "Authorization: Bearer $CRON_SECRET"
curl "http://localhost:3000/api/cron/daily" -H "Authorization: Bearer $CRON_SECRET"
```

`force=1` skips the market-hours check.

## Architecture

```
src/
  lib/
    types.ts            Shared types. Change here first.
    money.ts            Pure portfolio math, used by browser AND server. Unit tested.
    format.ts           Display formatting (PHP or USD).
    settings.ts         Default settings and merge logic.
    client/firebase.ts  Browser Firebase (lazy) and the api() fetch helper that sends the ID token.
    server/
      config.ts         Env vars.
      firebase.ts       Admin SDK (lazy).
      http.ts           requireOwner, requireCron, handler wrapper, HttpError.
      db.ts             Collection refs and reads. recomputePortfolio() writes meta/portfolio.
      ledger.ts         normalizeTx() validation and sign rules, addTxs().
      notify.ts         Alert email.
    market/
      alpaca.ts         Bars, news, latest trade, orders, account activities.
      pse.ts            PSE EDGE ids (cached in Firestore), daily bars, disclosures.
      rss.ts            PH business news, matched to tickers by company-name aliases.
      fx.ts             USD to PHP from open.er-api.com.
      hours.ts          Market session check.
    ai/
      scorer.ts         Headline scoring: dedupe, daily cap, batches of 20, prompt caching.
      extract.ts        Statement, email, CSV, PDF or screenshot to draft transactions.
    signals/
      technicals.ts     EMA50, RSI14, ATR14, volume ratio.
      engine.ts         runScan(market): data, scoring, rules, suggestions, alerts.
      daily.ts          runDaily(): FX, Alpaca sync, prices, snapshot, expiry, grading.
  app/
    api/...             Route handlers (see below).
    page.tsx and pages  Overview, Positions, Suggestions, Money, Scorecard, Brokers, Settings.
  components/           DataProvider (auth plus live Firestore subscriptions), Shell, charts, forms.
```

### Data flow

1. The browser only reads Firestore (live `onSnapshot`). `firestore.rules` denies all client writes.
2. Every write goes through an API route that verifies the Firebase ID token and the owner email, validates input with `normalizeTx`, writes with the Admin SDK, then calls `recomputePortfolio()`.
3. `meta/portfolio` is a cached copy of `computePortfolio()` so the 15-minute scans read one document instead of the whole ledger. Any code that writes transactions must call `recomputePortfolio()` afterwards.
4. The browser recomputes the portfolio itself from the transactions it already has, using the same `money.ts`, so the UI updates instantly.

### API routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/cron/scan?market=PH\|US` | cron secret | Session scan. Called every 15 min by GitHub Actions. |
| `GET /api/cron/daily` | cron secret | Daily job. Called by Vercel Cron at 22:00 UTC (6am Manila). |
| `POST /api/sync` | owner | "Sync now" button: FX, Alpaca activities, held prices, snapshot. |
| `POST/PATCH/DELETE /api/transactions` | owner | Create (one or a list), edit or confirm, delete. |
| `POST/PATCH/DELETE /api/brokers` | owner | Manage brokers. Delete is refused while transactions exist. |
| `PUT /api/settings` | owner | Validated partial update of `meta/settings`. |
| `POST /api/suggestions/[id]` | owner | `{do: "execute" \| "done" \| "dismiss", fill?}`. Claims the doc in a transaction first. |
| `POST /api/import/extract` | owner | Form data: brokerId plus text or file. Returns drafts, saves nothing. |
| `GET /api/health` | owner | Which integrations are configured (booleans only) plus last price and snapshot times. Shown on Settings. |
| `POST /api/import/webhook` | webhook secret | Make.com sends broker confirmation emails here; rows saved as `needs_review`. |

### Firestore collections

| Collection | Doc id | Notes |
|---|---|---|
| `brokers` | auto | name, market (PH or US), currency, connection (`alpaca`, `email`, `manual`), lastSyncAt |
| `transactions` | auto, or `alpaca_<activityId>`, `email_<messageId>_<n>` | See `Tx` in types.ts. Deterministic ids make imports idempotent. |
| `suggestions` | auto | `Suggestion`; `outcome.d5/d20/d60` filled by grading |
| `prices` | `PH_JFC`, `US_NVDA` | Last price and indicators |
| `news` | sha256(ticker + normalized headline) | Scored headlines; also the dedupe key |
| `snapshots` | `YYYY-MM-DD` (Manila day) | Daily net worth for the history chart |
| `pseIds` | ticker | Cached PSE EDGE company and security ids plus company name |
| `meta` | `settings`, `portfolio` | Settings and the cached portfolio |

No composite indexes are needed. Queries filter on one field and the rest is done in memory, which is fine at single-user scale.

### Money rules (do not break these)

- `Tx.amount` is the signed cash effect on the broker account in the broker's currency. Buys negative (gross plus fees), sells positive (net of fees), deposits, dividends and interest positive, withdrawals and fees negative. `normalizeTx` enforces the sign from the type.
- Cost basis uses the average cost method. A buy adds `-amount` (so fees are part of cost). A sell removes a proportional slice of cost and books realized P&L.
- `fxToPhp` is stored on every transaction at the rate of the day it was recorded, so historical PHP figures do not move when the rate changes.
- Only `status: "confirmed"` rows count. Email imports land as `needs_review`.
- Any change to `money.ts` needs a test in `src/lib/money.test.ts`.

### Signal rules (engine.ts)

Held positions are checked every scan, in this order, one suggestion per position:

1. SELL when the last price is under the stop. The stop is the one saved on the buy (from a suggestion plan), otherwise average cost minus 2x ATR.
2. TRIM when the position is over `maxPositionPct` of net worth. Quantity brings it back to about 95% of the limit, rounded to PSE board lots for PH.
3. WATCH when the news score is at or below minus the threshold.

Watchlist tickers not held get a BUY when all of these hold: news score at or above the threshold, price above EMA50, RSI under 72, volume ratio at least 1. Sizing: risk `riskPerTrade` of net worth between entry and stop (2x ATR), capped at `maxPositionPct`. If the default broker lacks the cash, `plan.cashNeeded` tells Mark how much to transfer from his bank first.

Cooldown: no repeat of the same ticker, action and broker while one is open or within `cooldownH`.

The LLM only scores news. It never decides trades. Keep it that way: deterministic rules can be graded and debugged.

## Setup (first deploy)

1. Firebase console: create a project. Enable Firestore (production mode) and Authentication with the Google provider. Under Authentication settings, add the Vercel domain to Authorized domains.
2. Project settings, General: add a Web app and copy its config into the `NEXT_PUBLIC_FIREBASE_*` vars.
3. Project settings, Service accounts: generate a private key and copy `project_id`, `client_email` and `private_key` into the `FIREBASE_*` vars.
4. Put the owner email in `firestore.rules`, then deploy the rules: `npx firebase-tools deploy --only firestore:rules`.
5. Vercel: import the GitHub repo, add every var from `.env.example` (Production and Preview). `CRON_SECRET` is also what Vercel Cron sends.
6. GitHub repo, Settings, Secrets and variables, Actions: add `APP_URL` and `CRON_SECRET`.
7. Gmail: turn on 2FA, create an App Password, put it in `SMTP_PASS`.
8. Alpaca (optional): paper keys first. Leave `ALPACA_PAPER=true` until the scorecard has 50 or more graded suggestions. US scans need Alpaca keys for market data even without an Alpaca broker.
9. Email import for no-API brokers (optional): in Make.com, create a scenario with Gmail "Watch emails" on a label that receives the broker's trade confirmations, then an HTTP module POSTing JSON `{brokerId, messageId, subject, text}` to `/api/import/webhook` with header `x-webhook-secret`.
10. Sign in, add brokers on the Brokers page, record opening deposits and existing holdings (or import statements), pick default brokers in Settings.

## Running cost

| Item | Cost |
|---|---|
| Vercel Hobby | $0 (one cron per day allowed, which is why scans run from GitHub Actions) |
| Firebase Spark | $0. Budget: about 20k reads a day from scans, under the 50k free limit. |
| GitHub Actions | $0 on a public repo. A private repo uses about 1,500 of the 2,000 free minutes a month, because each run bills a minimum of 1 minute. If that gets tight, scan every 20 minutes. |
| Claude Haiku | A few dollars a month. Capped by `maxScoredPerDay`. Dedupe and batching keep calls low. |

## Known limits

- PSE EDGE endpoints are undocumented and can change without notice. PH prices are daily bars, and the current day can lag.
- PSE disclosure titles are often generic ("Press Release"), so they score with low confidence. See backlog item 1.
- PSE tick sizes are not applied to suggested prices. Board lots are, using a table in `money.ts` that should be checked against the current PSE rules.
- Market holidays are not skipped; those scans just find nothing new.
- GitHub scheduled workflows can run several minutes late and are disabled after 60 days without repo activity.
- Alpaca executions are recorded when activities sync (daily, or on "Sync now"), not instantly.
- The scorecard is meaningless below about 50 graded suggestions. The UI says so.
- Sizing uses whole net worth. With a small US account, high-priced stocks round down to zero shares and no BUY is made.
- None of this is financial advice. The app gives rule-based signals with their reasons, and Mark decides.

## Hardening notes (2026-11-12 audit)

- `normalizeTx` coerces and validates every number, real calendar dates, tickers and status. Never write a transaction without it.
- Bulk imports (array body to `/api/transactions`) skip rows identical to existing ones; rows with an `externalId` never overwrite an existing doc, so a replayed email cannot undo a confirmation.
- Secrets are compared in constant time. 500 errors return a generic message; details go to the server log. Alpaca order rejections are `HttpError(502)` so the reason still reaches the UI.
- Scans take a per-market Firestore lock (`meta/lock_scan_<market>`, 5 min) so overlapping runs cannot create duplicate suggestions.
- RSS feeds must be public https URLs (`lib/server/urls.ts`). External fetches have timeouts.
- `next.config.ts` sets CSP and security headers. If sign-in ever breaks after adding a new Google/Firebase origin, check the CSP first.

## Backlog, in priority order

1. Fetch the disclosure body (`openDiscViewer.do`) for generic PSE titles before scoring.
2. Weekly Sonnet summary email per held ticker through the Batch API (half price, not time-sensitive).
3. Apply PSE tick-size rounding to entry, stop and target.
4. PSE holiday calendar in `hours.ts`.
5. Realized P&L and dividend income by year on the Money page (data is already in `Position.realized`).
6. Interactive Brokers connector (Client Portal API) as a second `connection` type, same shape as Alpaca.
7. A backtest script using Alpaca historical news to tune `newsThreshold` before trusting live signals.

## Conventions

- TypeScript strict. No `any` unless an external payload forces it; parse and narrow at the boundary.
- Server-only modules import `"server-only"`. Browser code never imports from `lib/server`, `lib/market`, `lib/ai` or `lib/signals`.
- Keep the visual language in `globals.css` (CSS variables, light and dark). Charts label their values directly on the chart; never rely on hover tooltips or a colour legend alone.
- No live order is ever placed without Mark pressing Approve. Do not add auto-execution.
- Every write path calls `recomputePortfolio()`.
