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
| every 15 minutes | `/api/cron/scan?key=…` | scans the most liquid pairs, pushes qualified signals and auto-monitors them |

Nothing has to be set up by hand: when the Telegram panel is opened the app registers two pg_cron jobs in the Supabase database (monitor every minute, scan every 15 minutes, using pg_net to call the endpoints) and the panel shows a green confirmation. The key is `CRON_SECRET` if you set it in Vercel, otherwise it is derived from the owner password. Fallbacks: a free scheduler such as cron-job.org pointed at the two links, or the GitHub Actions workflow (`.github/workflows/boma-cron.yml`) with the repository secret `BOMA_CRON_KEY`.

### Setups forming

Qualified signals need a pullback into the zone and a closed 1H candle through the trigger, which the backtest showed happens about twelve times a month across 30 pairs. So the scan also pushes the best **setups forming** (trend, regime and quality already in place, retest or close still missing) once per plan, with their levels, what must still happen, and Monitor / Re-analyse / Ignore buttons. The top six are followed automatically so the trigger and entry-range alerts arrive the moment they become actionable. The server scan covers the 50 most liquid pairs by default (`SERVER_SCAN_PAIRS`).

### Telling the bot about your trade

- Every signal and entry-range alert carries buttons: **Entered at plan price**, **Entered at…** (the bot asks for your fill price; reply with the number), **Monitor & prioritise** and **Re-analyse**; entry-range alerts add **Skipped**.
- `/entered BTCUSDT 68500` records your fill (price optional) and arms exit tracking; the pair is prioritised on the server and shown first in the app's side panel.
- `/monitor BTCUSDT` and `/unmonitor BTCUSDT` manage server-side monitoring from Telegram.
- `/skip BTCUSDT` stops following that plan; a new plan for the pair still alerts.
- `/status` lists monitored pairs and open trades.

Once entered you are told at each target, at the stop, when the engine sees a structure change against the trade (leave or protect the stop), when the runner should be closed after target 2 and when the maximum hold time is reached.

## Whales & crowd positioning

A section under the signals shows, for every signal and monitored pair, how live positioning relates to the plan:

- **Whales**: the open positions (side, size, entry, leverage, liquidation price, PnL) of the top 60 Hyperliquid traders by 30-day profit with at least $1M in the account, read from Hyperliquid's public API and cached for 3 minutes. The verdict says whether most whale notional sits with or against the plan.
- **Crowd**: Bybit's own long/short account ratio, 24-hour open-interest change and funding rate for the pair.
- **Liquidation pocket**: whale liquidation prices within 3% of the plan's stop are flagged so the stop is not widened into them.

No public site shows individual Bybit or Binance positions, so Bybit is covered through its aggregate ratios. Server-pushed signals carry the same verdict in a `🐋` line.
