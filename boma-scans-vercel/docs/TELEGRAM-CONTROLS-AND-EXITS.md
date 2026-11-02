# Telegram controls and realistic exits

2 November 2026, Version 15 Site.

No synced trade records were available to calculate the reported TP3 hit rate. No historical win-rate improvement is claimed.

## New target maps

The old target selector permitted 20 ATR / 12R distances and weighted distant runners heavily. New maps select actual TA candidate clusters within a mode-specific distance budget, bounded by observed favourable excursions over completed historical candle windows. Windows: scalp 6 candles, day 8, swing 12, position 20. Hard ATR caps: 2, 3.5, 5, 8 respectively. These are policy distance bounds, not calibrated target-hit probabilities. Missing nearby evidence is marked unconfirmed; it does not cause the engine to push targets farther out to pass a payoff gate.

New plans bank 40% at TP1, 35% at TP2, 15% at TP3, then 5% each at TP4/TP5. The primary objective is banking 75% at TP1/TP2. After recorded TP2, retreat to TP1 or expiry of the runner allowance produces close-remainder advice. Day runners have a 2h allowance after recorded TP2. Existing journal trades keep their saved levels and weights.

Weighted reward must meet 1.2R, plus the existing quality, structure, participation and execution checks; the previous 2.5R requirement encouraged reliance on distant levels. Estimated spread, round-trip fees and slippage are deducted from preferred net reward, and TP1 must clear those costs. Funding and actual fills remain uncertain. Reducing target distances changes payoff and can require a higher hit rate; it does not establish positive expectancy.

## Entry timing

Pullbacks now require a sweep of prior eight-candle swing liquidity, a closed-candle reclaim, and a later confirmation beyond the rejection high/low. No flexibility mode bypasses this condition. Fixed stops are never moved to rescue an invalidated entry. A failed plan stays cancelled. More restrictive confirmation can skip trades and cannot prevent every stop-out.

## Telegram

Menu buttons select 1h/2h/4h, Strict/Balanced/Flexible, request scans and show synced trades. Commands: /analyse PAIR [timeframe], /timeframe, /style, /risk, /equity, /fee, /slippage, /interval, /autoscan, /direction, /filter, /alerts, /settings, /scan, /trades, /menu. Plain pair names also request fresh analysis. Unqualified analyses are labelled WAIT / NO APPROVED ENTRY.

Full dashboard opens the existing authenticated Site as a Telegram Web App for chart, trade journal, manual fill/exit recording and all remaining controls. Telegram does not execute exchange orders.

Private Sites cannot directly accept Telegram's unauthenticated webhook. Commands therefore use owner-authenticated getUpdates polling while the dashboard is open. Database leases and update IDs prevent duplicate processing across devices. Foreign chats are ignored. Commands older than 30 minutes are ignored; no existing webhook is removed automatically. This is not an independent 24/7 bot service.

Validation: 55 automated engine, account, command parser and update-processing tests, TypeScript and production build. Real Telegram menu delivery is verified separately; live market command responses and target performance have not been independently verified.
