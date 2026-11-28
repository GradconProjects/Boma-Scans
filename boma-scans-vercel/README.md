# Boma Scans — Vercel edition

Independent Bybit USDT-perpetual scanner, chart, trade planner and Telegram signal bot, packaged to run on [Vercel](https://vercel.com) with your [Supabase](https://supabase.com) Postgres database (Turso/libSQL also supported). No ChatGPT or Cloudflare account is needed.

This edition contains the backtest-calibrated signal policy described in [docs/BACKTEST-AND-SIGNAL-POLICY.md](docs/BACKTEST-AND-SIGNAL-POLICY.md): 1H execution timeframe, 1R-5R scale-out exits, fee gate, trending regime and full multi-timeframe alignment.

## What you need

- A GitHub account with this repository (or a copy of this folder) pushed to it.
- A free Vercel account.
- Your Supabase project (the database for settings, trade journal and Telegram state). The tables are created automatically on first connection and are protected by row-level security, so Supabase's public REST API cannot read them.
- Optional: a Telegram bot token from `@BotFather` for alerts and commands.

## Deploy in 5 steps

### 1. Choose an owner password

Generate a password of at least 32 characters with a password manager. You will type it once per device at `/login`. It never goes into the source code.

### 2. Import the project into Vercel

1. In Vercel click **Add New → Project** and import your GitHub repository.
2. If this folder is not at the repository root, open **Root Directory** and select `boma-scans-vercel`.
3. Framework preset: **Next.js** (detected automatically). Leave the build settings as they are.

### 3. Connect the database

Easiest: in the Vercel project open **Storage → Connect Store → Supabase**, pick your existing Supabase project and accept. Vercel adds `POSTGRES_URL` (and related variables) to the project for you.

Manual alternative: in Supabase click **Connect** at the top of the dashboard, choose **Transaction pooler** (port 6543), copy the URI, replace `[YOUR-PASSWORD]` with your database password, and add it in Vercel as `POSTGRES_URL`.

### 4. Add the remaining environment variables

Under **Settings → Environment Variables** add:

| Name | Value |
| --- | --- |
| `BOMA_SYNC_SECRET` | your 32+ character owner password |
| `TELEGRAM_BOT_TOKEN` | optional, from `@BotFather` |
| `TELEGRAM_CHAT_ID` | optional; you can also enter it inside the app |

### 5. Deploy

Click **Deploy** (or **Redeploy** if the variables were added after the first build). Open the URL Vercel gives you, go to `/login`, enter the owner password, and the top bar shows **Signed in**.

To connect Telegram, open the Telegram panel in the app, enter your numeric chat ID (send `/start` to `@userinfobot` to see it) and click **Connect & send test**. Send `/menu` to your bot for the command keyboard. Keep the dashboard open on one device: the scanner runs in the browser and the app polls Telegram for commands while a signed-in dashboard is open.

### Using Turso instead of Supabase

Set `TURSO_DATABASE_URL` (and `TURSO_AUTH_TOKEN`) instead of `POSTGRES_URL`. The same code runs on either; locally `TURSO_DATABASE_URL=file:local.db` needs no account at all.

## Region: why `vercel.json` pins Sydney

Bybit blocks requests from United States servers, and Vercel's default region is Washington DC. `vercel.json` sets `"regions": ["syd1"]` so the market-data proxy runs from Sydney. If you deploy somewhere else, choose any non-US region close to you (for example `sin1`, `hnd1`, `fra1`).

## Usage limits to know about

The scanner calls the `/api/bybit` proxy once per timeframe per pair, so a full scan is several hundred serverless invocations. On the Vercel Hobby plan (1 million invocations per month) that comfortably supports hourly auto-scans with the dashboard open all day, but 15-minute scans around the clock can exceed it. The Pro plan removes the concern. Settings and journal sync every 15 seconds and Telegram commands every 10 seconds while the dashboard is open.

## Local development

```bash
cp .env.example .env.local      # TURSO_DATABASE_URL=file:local.db works locally
npm install
npm run dev                     # http://localhost:3000
npm test && npm run typecheck   # engine tests, Postgres SQL tests (in-process Postgres) and type check
```

Bybit's API is also geo-blocked from some countries and from many cloud providers; if local scans show "blocked access from your country", the deployed Sydney region will still work.

## Moving from the Cloudflare or ChatGPT-hosted version

On the old site open Trade manager → **Export trade backup**; on the new site sign in and choose **Import backup**. Telegram settings are entered again in the Telegram panel.

## Privacy

Market data is fetched through your own deployment. The database holds only your workspace settings, trade journal and Telegram delivery log. No exchange API keys are used and no orders are placed.

## Autonomous monitoring (app closed)

Two server endpoints do the work of the open dashboard. Point any scheduler at them (the Telegram panel shows the exact links with your key):

| Call | Path | What it does |
| --- | --- | --- |
| every 1 minute | `/api/cron/monitor?key=…` | reads Telegram commands, re-analyses every monitored pair, pushes entry / exit / leave alerts and the hourly digest |
| every 3 hours | `/api/cron/scan?key=…` | scans the most liquid pairs, pushes qualified signals and auto-monitors them |

Nothing has to be set up by hand: when the Telegram panel is opened the app registers two pg_cron jobs in the Supabase database (monitor every minute, scan every 3 hours, using pg_net to call the endpoints) and the panel shows a green confirmation. The key is `CRON_SECRET` if you set it in Vercel, otherwise it is derived from the owner password. Fallbacks: a free scheduler such as cron-job.org pointed at the two links, or the GitHub Actions workflow (`.github/workflows/boma-cron.yml`) with the repository secret `BOMA_CRON_KEY`.

### Setups forming

Qualified signals need a pullback into the zone and a closed 1H candle through the trigger, which the backtest showed happens about twelve times a month across 30 pairs. So the scan also pushes the best **setups forming** (trend, regime and quality already in place, retest or close still missing) once per plan, with their levels, what must still happen, and Monitor / Re-analyse / Ignore buttons. The top six are followed automatically so the trigger and entry-range alerts arrive the moment they become actionable. The server scan covers the 50 most liquid pairs by default (`SERVER_SCAN_PAIRS`).

### Telling the bot about your trade

- Every signal and entry-range alert carries buttons: **Entered at plan price**, **Entered at…** (the bot asks for your fill price; reply with the number), **Monitor & prioritise** and **Re-analyse**; entry-range alerts add **Skipped**.
- `/entered BTCUSDT 68500` records your fill (price optional) and arms exit tracking; the pair is prioritised on the server and shown first in the app's side panel.
- `/monitor BTCUSDT` and `/unmonitor BTCUSDT` manage server-side monitoring from Telegram.
- `/skip BTCUSDT` stops following that plan; a new plan for the pair still alerts.
- `/status` lists monitored pairs and open trades.

Once entered you are told at each target, at the stop, when the engine sees a structure change against the trade (leave or protect the stop), when the runner should be closed after target 2 and when the maximum hold time is reached.

## AI reviewer (Anthropic or OpenAI)

Every ready-to-enter signal gets a careful second read before it reaches Telegram. The reviewer receives the plan, every entry check, the market structure, the historic levels, the whale and crowd positioning, BTC context and the last 24 1H candles, and answers in a fixed shape: APPROVE, CAUTION or REJECT with a confidence, a one-line summary, up to three concerns, an entry note and an exit note.

- **APPROVE / CAUTION** are pushed with the note appended. **REJECT** is held: nothing is pushed, and the pair appears under "Held by review" in the hourly monitor list and in the app.
- Each plan is reviewed once (cached six hours). The app's signal cards show the verdict and offer "Review now"; on Telegram `/why BTCUSDT` gives a plain-English read, `/review BTCUSDT` a fresh verdict.
- **Provider switch**: Anthropic (default model `claude-opus-5-5`, via the official `@anthropic-ai/sdk` with structured output and adaptive thinking at high effort) or OpenAI (default model `gpt-5`, via the official `openai` SDK with a strict JSON schema). Set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` in Vercel and choose in the Telegram panel or with `/ai anthropic|openai|off`. Override models with `ANTHROPIC_MODEL` / `OPENAI_MODEL`. Reviews are billed on your own provider account; a review is a few thousand input tokens.
- **Levels are refined before they are final.** The reviewer may move the entry inside the plan's zone, place the stop at a structural level between 0.6× and 1.5× the engine's stop distance, and set five targets between 0.5R and 6R in the trade's direction. Refinements inside those guardrails become the signal's levels (card, fill check, exit tracking); anything outside is discarded and shown as "suggested but kept engine levels". The trigger and the closed-candle rule never change.
- The signal logic itself stays rule-based and backtestable; the reviewer can hold a signal or refine its levels but never invents one.

## Whale system (second system, /whales)

After sign-in the start page offers two systems. The whale system is independent of the scanner and follows one rule: **follow what consistently successful whales are doing now, not what their existing positions say.**

- **Persistent history.** Positions of the 60 most profitable Hyperliquid accounts (≥ $1M) are snapshotted every 3 minutes and diffed into OPEN, ADD, REDUCE, CLOSE and FLIP events stored in the `whale_events` table with P&L and holding time.
- **Rankings.** Consistency first: a point per profitable window (day, week, month, all time), 30-day ROI capped, and our own tracked closes once a whale has five or more. Elite = top 10, Strong = next 15, the rest Watch.
- **Entry signals (confirmation engine).** Directional whales only (market makers never count). An entry is confirmed by a cluster of two or more directional whales (score 1.8+), one ranked whale with $1M+ of new money, or any directional whale with $3M+, all within 24 hours. Adds to positions already more than 5% in profit and older than a day count at 40%. Directional whales on the other side subtract. Price more than 2.5% past their average entry is "ran away". Setups that are not there yet are listed as "Building".
- **Exit signals.** When the whales behind an issued entry start leaving (half of them, or the one who led), or two or more directional whales close or flip the same side within six hours, a WHALE EXIT with urgency LEAVE is raised; a single cut on a followed side raises REDUCE. Both carry the whales' realised P&L and holding time, in the app and on Telegram.
- **Own logic.** Direction and entry area from the whales, risk from the Bybit 1H chart: stop 1.5 ATR beyond their average entry, targets at 1R / 2R / 3R, and the scanner's trend read says whether the chart agrees. Each signal links to the pair in the scanner.
- **Event-driven alerts.** Telegram gets confirmed whale signals (55%+ confidence) and $250K+ opens, closes and flips by ranked whales, filterable by tier and coin on the Rules & alerts tab.
- **Full entry analysis inside the section.** Every confirmed signal, every activity row and a free-text coin box offer a full entry analysis without leaving the whale system: what the ranked whales did (entries, new money, who is against), what the Bybit 1H rule engine says (window, trigger, stop, targets, checks, historic levels, the ENTER NOW / WAIT call), crowd positioning, and the AI planner's whale-specific plan (decision, entry window, trigger, stop, targets, invalidation, risks, management) under guardrails (window ≤ 3 ATR, stop 0.8–2.5 ATR beyond the window, targets 1R–5R). The plan can be sent to Telegram with one tap.
- **Early warning on your trades.** Tap "I entered" on any coin (or `/wentered SOL LONG 150.2` on Telegram). Every directional whale move on that coin then reaches Telegram within a minute, classed as with or against your side: CRITICAL when a ranked whale closes or flips your side or against-money is double the with-money above $1M, WARNING when against-money leads, INFO when whales back you. Each alert carries the moves with sizes, P&L and holding time, your entry and live P&L, and instructions in figures from the AI planner (HOLD, TIGHTEN STOP to a price, REDUCE a percentage, EXIT NOW) under guardrails, plus a check-in every six hours. "I exited" or `/wexit SOL` stops it.
- **From "I entered" to "I exited".** Recording a trade sends a confirmation card at once: entry, stop and three targets with percentages and R (the 1H engine's levels when the chart agrees with the whales, otherwise a 1.5 ATR stop and 1R / 2R / 3R), the whales' stance and the chart read. Then, every minute until you tap "I exited": each target and the stop as price reaches them, structure changes against the trade (leave / protect), every whale move with instructions, and the six-hourly check-in. "I exited" sends a closing summary with the result and holding time.
- **Before Telegram cross-check.** Every signal card in the Before Telegram build shows what the ranked whales are doing on that pair: with, against or neutral, the ranked book and their last moves; against means half size or skip.
- **No execution.** Copy trading waits until API accuracy, historical profitability and live signal performance are verified from this history.

## Every Bybit pair is graded

The scanner (in the app and on the server) grades every trading USDT perpetual on Bybit with more than $100K of daily turnover, several hundred pairs, not only the most liquid ones. A pair still needs at least $2M of daily turnover (Day style; $1M Swing, $10M Scalp) and a spread-plus-fees cost inside the engine's limit to qualify as a signal, so thin markets are graded and shown but do not produce pushes.

## The call: ENTER NOW or WAIT

Every signal card, in the app and on Telegram, opens with the call at the live price: **ENTER NOW** when the plan is READY and a limit at the entry would fill inside the entry window (shown as a price range), **WAIT** with the exact condition (the 1H close through the trigger, or a pullback into the window after price ran past it), or **STAND DOWN** when the plan is invalid. The reviewer makes the same call independently ("Timing: ENTER NOW / WAIT / STAND DOWN" with the prices), so a push you act on has both the engine and the reviewer saying now.

## What Telegram sends, and when

The phone is for decisions, not noise. The scanner pushes an **entry call** only when all of these hold: the engine's plan is READY, a **major structural event** happened on the trade's side (change of character, break of structure or liquidity sweep, or a breakout / CHoCH-reversal setup), the **stop can hold about four hours** (at least two 1H ATRs from the entry, and the last four candles never traded within 20% of it), the **ranked whales are not against it** (fresh whale money or the ranked open book on the other side holds the signal), and the AI reviewer did not reject it. Held signals are listed in the app with the reason. Regular monitoring messages (entry range, confirmation, expiry, stop-side hit) go **only to pairs you marked as entered**; exits and leave / protect advice are for entered pairs by nature. The hourly monitor list is off unless `telegramDigest` is enabled in the workspace; `/status` prints it on demand. In the whale system, pairs you choose to **monitor alone** report every directional whale move of $100K+ as it happens, plus their entry and exit signals without the confidence floor.

### Trading windows

Every page and every entry call states the Melbourne time in bold with **GOOD TIME TO TRADE** or **NOT A GOOD TIME TO TRADE** and the next good window. The good windows are Wednesday to Sunday, outside 03:00–10:00. By default every entry call is still pushed (flagged when outside); the Trading windows box in the Telegram panel or `/windows backtested` holds calls outside the windows, `/windows all` releases them. In two years of this engine's signals those windows held 69% winners at +0.6R a trade with a maximum drawdown under 4R, against 51% and +0.2R for all hours (details in the policy document). Switch with the Trading windows box in the Telegram panel or `/windows all` / `/windows backtested`. Entered trades are managed in every hour regardless.

### Signals mirror the whales

Where a Bybit pair is listed on Hyperliquid, every scanner push states the ranked whales' stance (fresh money in the last 24 hours first, then their open book). Whales against the side hold the push; whales with it are stated on the card; the AI reviewer is told the same rule.

## How long a plan stays valid

A confirmed plan is valid for 2 candles in Scalp, 24 candles (a day on the 1H chart) in Day, 72 in Swing and 120 in Position, so a resting day-trade order can sit overnight. The plan is still cancelled early when a candle closes beyond the zone or price crosses the stop, and the Telegram card's "Expires" line shows the real deadline. Every Telegram message that shows a plan carries the Entered / Entered at… buttons, including confirmations, plan updates, the hourly digest and the expiry notice, so a trade you joined can be recorded at any point.

## Historic support & resistance

Signals are read against higher-timeframe history, not only the last few hours. Daily and weekly swing highs and lows (plus yearly, multi-year and prior-month extremes) are clustered into zones. The zones become the strongest take-profit candidates, and each signal states the nearest major level in its path and the room to it in R. The two-year backtest showed that blocking trades for lack of room removed the best trades (trend breaks through levels), so the levels inform the exit plan rather than veto the entry; see the policy document for the numbers. The levels panel shows the nearest support and resistance with frame and touch count ("S 1.1900 (W×3) · R 1.2600 (D×2) · room 1.8R"), the chart draws the zones as dashed lines, and Telegram cards carry the same line.

## Whales & crowd positioning

A section under the signals shows, for every signal and monitored pair, how live positioning relates to the plan:

- **Whales**: the open positions (side, size, entry, leverage, liquidation price, PnL) of the top 60 Hyperliquid traders by 30-day profit with at least $1M in the account, read from Hyperliquid's public API and cached for 3 minutes. The verdict says whether most whale notional sits with or against the plan.
- **Other venues** (no keys needed): Binance and OKX top-trader long/short position ratios and all-account ratios. Top traders across venues plus the Hyperliquid whales form a "smart money" consensus that feeds the verdict.
- **Crowd**: Bybit's own long/short account ratio, 24-hour open-interest change and funding rate for the pair.
- **In the signal**: every signal card in the app and every entry-range, confirmed and qualified-signal alert on Telegram carries the verdict and a one-line summary of how each venue stacks up against the plan.
- **Liquidation pocket**: whale liquidation prices within 3% of the plan's stop are flagged so the stop is not widened into them.

No public site shows individual Bybit or Binance positions, so Bybit is covered through its aggregate ratios. Server-pushed signals carry the same verdict in a `🐋` line.

## Plain-English cards

Every Telegram card and app panel now starts with **What to do** in everyday words, then **Why**, then the technical **Details**.

- Whale entry: buy or sell, near what price, where the stop-loss goes and how big the loss is, the three profit targets, and whether to use normal or half size.
- Whale exit: close now, or close half and move the stop-loss to your entry. Ignore it if you are not in the trade.
- Whale warning on your trade: close, reduce, move the stop-loss, or do nothing.
- Whale analysis: a one-line instruction plus a short beginner summary written by the AI (no jargon).
- Scanner signals and WAIT cards: a one-line "In plain words" instruction.
- The Whales section, Rules tab, has a "How to read the whale cards" guide (LONG, SHORT, stop-loss, targets, R, ATR, tiers and each signal status).

Shared wording lives in `app/lib/plain-words.ts`.

## Positioning: whales vs smart money vs Bybit crowd

Every signal, whale card, whale analysis and chart card now carries a detailed positioning section that compares three groups:

| Group | Who | How it is read |
|---|---|---|
| 🐋 Whales | Ranked, consistently profitable Hyperliquid traders: their open book and their new money in the last 24 h and 6 h | Followed. New money counts more than old positions. |
| 🏦 Smart money | Binance and OKX top traders | Followed. |
| 👥 Bybit crowd | Ordinary Bybit accounts, plus Binance and OKX all-account ratios, funding and open interest | Read the opposite way. A crowded side is fuel for the other side. |

The section shows each group's side and strength with figures, then how they line up (the pattern), a LONG and SHORT positioning score out of 100, a four-point checklist, and plain advice for the side you are considering.

Patterns, best first: strong hands vs crowd, strong hands aligned, whales vs crowd, whales lead, everyone on one side (crowded and late), whales vs smart money (conflict), smart money leads, only the crowd is one-sided, no edge.

- Telegram: `/positioning SOL` or `/positioning SOL SHORT`, plus a 🧭 Positioning button on whale entry cards.
- App: Whales section, 🧭 Positioning tab, for any coin and side.
- The AI planner must name each group's side and explain how the pattern changed its decision and size.

Code: `app/lib/positioning-matrix.ts` (logic and wording) and `app/server/positioning-matrix.ts` (live data).

## Whale System 2 (separate, shadow mode)

A fourth system at `/whales-2`, reachable from the system switcher and the chooser. It is a stricter second opinion that scores direction, entry timing, exhaustion and data reliability separately, can return NO TRADE, never averages different trader populations, never invents missing data, and logs every signal to measure its own accuracy before it is trusted.

It borrows data from the scanner and the original whale tracker and changes nothing in them. The pre-existing version is preserved on branch `backup/before-whale-system-2`.

- Telegram: `/ws2 NEAR`. Alerts only when a watchlist coin becomes ENTRY READY.
- Full method, limits, what was and was not tested, and how to remove it: `docs/WHALE-SYSTEM-2.md`.

## Market direction strip (all sections)

A strip under the top bar on every section shows the overall market direction, Bitcoin against the coins, and which one rules.

- **Overall:** BULLISH, BEARISH or MIXED, from Bitcoin's 1h and 4h trend and how many coins are up.
- **BTC vs coins:** side-by-side bars for 1 h, 4 h and 24 h, the share of coins that are up, and whether coins are stronger or weaker than Bitcoin.
- **Who rules:** BTC RULES when coins track Bitcoin closely and move with it, ALTS RULE when the link is weak or Bitcoin is quiet while coins move, otherwise SHARED.
- Tap it for the detail, the strongest and weakest coins against BTC, and a plain "what to do".
- "Coins" are the 30 most-traded crypto perpetuals on Bybit other than BTC. Stock and commodity contracts are left out. Refreshes every 3 minutes. Telegram: `/market`.

Code: `app/lib/market-direction.ts`, `app/server/market-direction.ts`, `app/components/market-direction-strip.tsx`.

## How the systems compare (three-year replay)

The Scanner and Whale System 2 were replayed on every Bybit crypto pair over three years with the same scoring. Neither showed a profit edge after fees; both beat random entries. LONG entries lost in both. Monday and Tuesday (Melbourne) lost money in both, in every year. Nothing is restricted because of this: readings and Scanner cards carry short flags (Monday/Tuesday, LONG side, low rating, no major event), each with a one-sentence reason. Full tables, the correction to the earlier Scanner backtest and two suggested Scanner changes are in `docs/SYSTEM-COMPARISON.md`.

## Telegram quiet mode (default)

Only confirmed entry calls are pushed: a Scanner confirmed entry, a confirmed whale entry signal, or Whale System 2 reaching ENTRY READY (once per coin and side, not repeated while it stays ready).

Also sent, because they are about your own trades or your own taps: targets, stops and advice on a trade you marked as entered, whales leaving a coin you are in, and confirmations when you record an entry or exit. Replies to commands and buttons always work.

Not sent: individual whale opens and closes, whale exits on trades you are not in, watch-list moves, six-hourly check-ins, digests and forming setups. They remain visible in the app.

The rule is enforced in one place, where every scheduled message is sent (`app/lib/telegram-policy.ts`). `/quiet off` sends everything again; `/quiet on` returns to entries only.

## Confirmed scan entries

A Scanner signal is a **confirmed scan entry**, and is pushed to Telegram, when every engine check has passed (READY) and the AI second read does not reject it.

The major-event check (change of character, breakout or sweep with a 2+ ATR stop) and ranked whales being on the other side used to hold the call. Together with READY they almost never coincided (twice in a three-year replay), so no scan entry reached Telegram. They are now flags on the card, each with its reason, and do not hold the call. Only the owner's own Monday/Tuesday switch, off by default, can hold a scan entry.
