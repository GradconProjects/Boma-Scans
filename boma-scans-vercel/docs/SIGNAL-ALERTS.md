# Signal cards and notifications

Boma Scans adds a visible Signals / Notifications workspace above the folded market scanner. Version 1.6 also includes the common retest, no-chase, entry-range and expiry rules described in [ENTRY-LOCATION.md](ENTRY-LOCATION.md).

## Use it

1. Run a live scan or leave Auto scan enabled.
2. Qualified long and short plans appear at the top of **Signals** with emojis, entry, stop, five targets, rating, leverage, account stop-risk and BTC context. The first two cards are shown immediately; **Show all** exposes every other qualified signal.
3. **Review chart** opens the current analysis for that pair, style and flexibility mode. **Paper plan** still requires the existing fresh-data, sizing and portfolio checks plus confirmation.
4. **Copy signal** copies a Telegram-style message. If clipboard access is blocked, selectable text is provided. This feature does not connect a Telegram bot or send messages automatically.
5. Open the bell or **Notifications** tab for saved setup alerts. Expand a message to mark it read, or use **Mark all read**. Marking an alert read does not record a trade.
6. Click **Enable sound** once in each opened/reloaded app tab. A short two-note chime confirms activation. Use **Test sound**, the volume slider, or **Sound on · tap to mute** to control it. Test sound also enables future setup chimes.

## What triggers an alert

Only completed live scans generate notifications. A candidate must pass the existing medium/low-risk entry gates, exchange rules, valid risk sizing and all five target slots. Partial scans, demo data, stale rows, rejected BTC divergence and unconfirmed targets do not generate alerts. The first qualifying scan also alerts.

Signals are identified by pair, long/short direction, trading style, flexibility and setup type. Continuing setups stay quiet across subsequent scans and reloads. If a complete scan finds that a setup is no longer qualified, its saved message is marked accordingly; requalification can produce a new alert. After a scan absence longer than six hours, a fresh qualified setup can alert again. One chime covers each new batch, with a ten-second minimum between automatic chimes in a tab.

An alert freezes the levels, score, sizing and numbered entry instructions at the scan. It is not a live quote or an execution approval. Snapshots expire at the earlier of their underlying confirmation expiry, fifteen minutes after scan, or two execution candles after scan. The latest Signals tab may contain an updated plan while an older notification correctly remains expired. Historical messages always instruct the reader to refresh the chart. Older alerts without entry instructions remain readable; refresh their chart for the current plan.

## Persistence and sound limits

The last 100 notifications, read status and deduplication state are stored on this device. Audio preference and volume are also saved. No server database, push subscription, bot token, microphone access or exchange key is required. Clearing browser storage removes the history.

Audio is activated in a click handler, following [browser Web Audio autoplay guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices#autoplay_policy). Saved sound preference does not bypass browser activation requirements. A paused context displays Enable sound again. Unsupported or blocked audio produces a visible message; the notification remains saved. Device silent mode, muted tabs or operating-system settings can still suppress sound.

Keep the app open, with scans running. Background throttling, device sleep and closed tabs can prevent timely scans or audio. This release provides in-app notifications and audio, not an always-running server service or Telegram delivery. Notifications are local to the active tab/device; multiple tabs are not coordinated as a single alert session.

## Verification

The regression suite now includes first-scan alerts, deduplication across scans/reloads, withdrawal and requalification, stale/demo/failed-gate rejection, the scan/UI-clock boundary, long/short identity, five-target copy formatting, bounded/corrupt history and sound scheduling/muting. Audio scheduling is tested with a mock context; actual playback on a device should be checked using Test sound.
