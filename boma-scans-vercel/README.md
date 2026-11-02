# Boma Scans — Vercel edition

Independent Bybit USDT-perpetual scanner, chart, trade planner and Telegram signal bot, packaged to run on [Vercel](https://vercel.com) with a [Turso](https://turso.tech) database. No ChatGPT or Cloudflare account is needed.

This edition contains the backtest-calibrated signal policy described in [docs/BACKTEST-AND-SIGNAL-POLICY.md](docs/BACKTEST-AND-SIGNAL-POLICY.md): 1H execution timeframe, 1R-5R scale-out exits, fee gate, trending regime and full multi-timeframe alignment.

## What you need

- A GitHub account with this repository (or a copy of this folder) pushed to it.
- A free Vercel account.
- A free Turso account (the journal/settings database; SQLite-compatible, about 1 minute to set up).
- Optional: a Telegram bot token from `@BotFather` for alerts and commands.

## Deploy in 6 steps

### 1. Create the database (Turso)

Install the Turso CLI (`curl -sSfL https://get.tur.so/install.sh | bash`) or use the Turso web dashboard, then:

```bash
turso auth signup
turso db create boma-scans --location syd
turso db show boma-scans --url
turso db tokens create boma-scans
```

Keep the URL (`libsql://boma-scans-....turso.io`) and the token. Tables are created automatically the first time the app connects.

### 2. Choose an owner password

Generate a password of at least 32 characters with a password manager. You will type it once per device at `/login`. It never goes into the source code.

### 3. Import the project into Vercel

1. In Vercel click **Add New → Project** and import your GitHub repository.
2. If this folder is not at the repository root, open **Root Directory** and select `boma-scans-vercel`.
3. Framework preset: **Next.js** (detected automatically). Leave the build settings as they are.

### 4. Add the environment variables

In the import screen (or later under **Settings → Environment Variables**) add:

| Name | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | the `libsql://...` URL from step 1 |
| `TURSO_AUTH_TOKEN` | the token from step 1 |
| `BOMA_SYNC_SECRET` | your 32+ character owner password |
| `TELEGRAM_BOT_TOKEN` | optional, from `@BotFather` |
| `TELEGRAM_CHAT_ID` | optional; you can also enter it inside the app |

### 5. Deploy

Click **Deploy**. The first build takes 2 to 4 minutes. Open the URL Vercel gives you, go to `/login`, enter the owner password, and the top bar shows **Signed in**.

### 6. Connect Telegram (optional)

Open the Telegram panel in the app, enter your numeric chat ID (send `/start` to `@userinfobot` to see it), and click **Connect & send test**. Send `/menu` to your bot for the command keyboard. Keep the dashboard open on one device: the scanner runs in the browser and the app polls Telegram for commands while a signed-in dashboard is open.

## Region: why `vercel.json` pins Sydney

Bybit blocks requests from United States servers, and Vercel's default region is Washington DC. `vercel.json` sets `"regions": ["syd1"]` so the market-data proxy runs from Sydney. If you deploy somewhere else, choose any non-US region close to you (for example `sin1`, `hnd1`, `fra1`).

## Usage limits to know about

The scanner calls the `/api/bybit` proxy once per timeframe per pair, so a full scan is several hundred serverless invocations. On the Vercel Hobby plan (1 million invocations per month) that comfortably supports hourly auto-scans with the dashboard open all day, but 15-minute scans around the clock can exceed it. The Pro plan removes the concern. Settings and journal sync every 15 seconds and Telegram commands every 10 seconds while the dashboard is open.

## Local development

```bash
cp .env.example .env.local      # TURSO_DATABASE_URL=file:local.db works locally
npm install
npm run dev                     # http://localhost:3000
npm test && npm run typecheck   # 59 engine tests + type check
```

Bybit's API is also geo-blocked from some countries and from many cloud providers; if local scans show "blocked access from your country", the deployed Sydney region will still work.

## Moving from the Cloudflare or ChatGPT-hosted version

On the old site open Trade manager → **Export trade backup**; on the new site sign in and choose **Import backup**. Telegram settings are entered again in the Telegram panel.

## Privacy

Market data is fetched through your own deployment. The database holds only your workspace settings, trade journal and Telegram delivery log. No exchange API keys are used and no orders are placed.
