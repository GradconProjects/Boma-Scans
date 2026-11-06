import { INTERVAL_MS, STYLE_CONFIG, formatPrice, type ScannerRow, type TakeProfitLevel, compactNumber } from "@/app/lib/market";
import { isMediumRiskTake, type MediumRiskRecommendation } from "@/app/lib/recommendations";
import { restoreEntryExecutionPlan, type EntryExecutionPlan } from "@/app/lib/entry-execution";

export const SIGNAL_STORAGE_KEY = "boma-scans:signal-notifications:v1";
export const SOUND_STORAGE_KEY = "boma-scans:signal-sound:v1";
export const MAX_NOTIFICATIONS = 100;

export type SignalSnapshot = {
  executionPlan?: EntryExecutionPlan;
  id: string;
  key: string;
  scope: string;
  createdAt: number;
  expiresAt: number;
  readAt: number | null;
  withdrawnAt: number | null;
  symbol: string;
  side: ScannerRow["bias"];
  style: ScannerRow["style"];
  flexibility: ScannerRow["flexibility"];
  setupType: ScannerRow["setupType"];
  regime: ScannerRow["regime"];
  rating: number;
  grade: string;
  score: number;
  entryQuality: number;
  entryGrade: string;
  riskBand: ScannerRow["riskBand"];
  entry: number;
  stop: number;
  targets: TakeProfitLevel[];
  rewardR: number;
  netRewardR: number;
  leverage: number;
  riskPct: number;
  riskAmount: number;
  quantity: number;
  margin: number;
  btcVerdict: string;
  btcRelationship: string;
  turnover?: number;
  btcDailyTrend?: string;
  trendAligned?: boolean;
  btcExplanation: string;
  needsAcknowledgement: boolean;
  proof: string[];
};

export type SignalLedger = {
  version: 1;
  notifications: SignalSnapshot[];
  scopes: Record<string, {at: number; keys: string[]}>;
};

export function emptySignalLedger(): SignalLedger {
  return {version: 1, notifications: [], scopes: {}};
}

export function signalScope(row: Pick<ScannerRow, "style" | "flexibility">) {
  return row.style + ":" + row.flexibility;
}

export function signalKey(row: Pick<ScannerRow, "style" | "flexibility" | "symbol" | "bias" | "setupType">) {
  return [signalScope(row), row.symbol, row.bias, row.setupType].join(":");
}

export function snapshotSignal(pick: MediumRiskRecommendation): SignalSnapshot {
  const row = pick.row;
  const key = signalKey(row);
  return {
    id: key + ":" + row.analyzedAt, key, scope: signalScope(row),
    createdAt: row.analyzedAt,
    expiresAt: Math.min(row.executionPlan.expiresAt, row.analyzedAt + Math.min(15 * 60_000, 2 * INTERVAL_MS[STYLE_CONFIG[row.style].interval])),
    executionPlan: {...row.executionPlan, steps: [...row.executionPlan.steps]},
    readAt: null, withdrawnAt: null,
    symbol: row.symbol, side: row.bias, style: row.style, flexibility: row.flexibility,
    setupType: row.setupType, regime: row.regime, rating: row.ratingScore,
    grade: row.ratingGrade, score: row.score, entryQuality: row.entryQuality,
    entryGrade: row.entryGrade, riskBand: row.riskBand, entry: row.entry, stop: row.stop,
    targets: row.takeProfits.map(target => ({...target, sources: [...target.sources]})),
    rewardR: row.rr, netRewardR: row.netRewardR, leverage: pick.leverage,
    riskPct: pick.riskPct, riskAmount: pick.riskAmount, quantity: pick.quantity,
    margin: pick.recommendedMargin, btcVerdict: row.btcRelationship.divergenceVerdict,
    btcRelationship: row.btcRelationship.relationship, btcExplanation: row.btcRelationship.explanation,
    turnover: row.turnover, btcDailyTrend: row.btcRelationship.btcDailyTrend, trendAligned: row.btcRelationship.trendAligned,
    needsAcknowledgement: row.btcRelationship.divergenceVerdict === "CAUTION" || row.qualityOverride.eligible || !row.btcRelationship.trendAligned,
    proof: row.entryChecks.filter(check => check.required && check.status === "PASS").map(check => check.label),
  };
}

/** Run only on a completed live scan, never on partial results or price ticks. */
/** `partial` = a scan is still running: add newly qualified pairs, but do not
 *  withdraw pairs that simply have not been re-analysed yet. */
export function reconcileSignals(ledger: SignalLedger, picks: MediumRiskRecommendation[], scope: string, scanAt: number, now: number, partial = false) {
  const previous = ledger.scopes[scope];
  if (now < scanAt || (previous && previous.at >= scanAt)) return {ledger, added: [] as SignalSnapshot[]};
  const qualified = picks.filter(pick => signalScope(pick.row) === scope && isMediumRiskTake(pick.row, true, now) && pick.quantity > 0 && pick.leverage > 0 && pick.row.takeProfits.length === 5 && pick.row.takeProfits[0].available);
  // A continuing setup stays quiet across scans/reloads; a new episode or a long
  // absence can alert again. A six-hour absence is not treated as continuity.
  const previousKeys = new Set(previous && now - previous.at <= 6 * 3_600_000 ? previous.keys : []);
  const currentKeys = new Set([...qualified.map(pick => signalKey(pick.row)), ...(partial ? previousKeys : [])]);
  const added = qualified.filter(pick => !previousKeys.has(signalKey(pick.row))).map(snapshotSignal);
  const notifications = ledger.notifications.map(item => item.scope === scope && !currentKeys.has(item.key) && !item.withdrawnAt
    ? {...item, withdrawnAt: now} : item);
  return {
    ledger: {
      version: 1 as const,
      notifications: [...added, ...notifications].slice(0, MAX_NOTIFICATIONS),
      scopes: {...ledger.scopes, [scope]: {at: scanAt, keys: [...currentKeys]}},
    },
    added,
  };
}

export function notificationStatus(item: SignalSnapshot, now: number) {
  if (item.withdrawnAt) return "NO LONGER QUALIFIED";
  if (now >= item.expiresAt) return "EXPIRED SNAPSHOT";
  return "RECHECK LIVE CHART";
}

/** Stored notifications are history, never a source of live recommendations. */
export function parseSignalLedger(raw: string | null): SignalLedger {
  const empty = emptySignalLedger();
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.notifications)) return empty;
    const notifications = parsed.notifications.filter((item: SignalSnapshot) => {
      if (!item || typeof item !== "object") return false;
      const numbers = [item.createdAt, item.expiresAt, item.rating, item.score, item.entryQuality, item.entry, item.stop, item.rewardR, item.netRewardR, item.leverage, item.riskPct, item.riskAmount, item.quantity, item.margin];
      const strings = [item.id, item.key, item.scope, item.grade, item.entryGrade, item.regime, item.setupType, item.btcVerdict, item.btcRelationship, item.btcExplanation];
      return numbers.every(value => typeof value === "number" && Number.isFinite(value)) &&
        strings.every(value => typeof value === "string" && value.length < 3000) &&
        typeof item.symbol === "string" && /^[A-Z0-9]{2,24}USDT$/.test(item.symbol) &&
        ["LONG", "SHORT"].includes(item.side) && Object.hasOwn(STYLE_CONFIG, item.style) &&
        ["STRICT", "BALANCED", "FLEXIBLE"].includes(item.flexibility) &&
        ["LOW", "MEDIUM", "HIGH"].includes(item.riskBand) && item.entry > 0 && item.stop > 0 &&
        Array.isArray(item.proof) && item.proof.length <= 30 && item.proof.every(value => typeof value === "string") &&
        (item.readAt === null || Number.isFinite(item.readAt)) && (item.withdrawnAt === null || Number.isFinite(item.withdrawnAt)) &&
        Array.isArray(item.targets) && item.targets.length === 5 && item.targets.every(target => target &&
          Number.isFinite(target.price) && target.price > 0 && Number.isFinite(target.rewardR) && Number.isFinite(target.exitPct) &&
          Number.isFinite(target.level) && typeof target.source === "string" && Array.isArray(target.sources) && target.sources.every(source => typeof source === "string"));
    }).slice(0, MAX_NOTIFICATIONS).map((item: SignalSnapshot) => ({...item, executionPlan: restoreEntryExecutionPlan(item.executionPlan)}));
    const scopes: SignalLedger["scopes"] = {};
    for (const [key, value] of Object.entries(parsed.scopes ?? {})) {
      const scope = value as {at: number; keys: string[]};
      if (/^(SCALP|DAY|SWING|POSITION):(STRICT|BALANCED|FLEXIBLE)$/.test(key) && scope && Number.isFinite(scope.at) && Array.isArray(scope.keys) && scope.keys.every(item => typeof item === "string")) {
        scopes[key] = {at: scope.at, keys: scope.keys.slice(0, 2000)};
      }
    }
    return {version: 1, notifications, scopes};
  } catch { return empty; }
}

export function telegramSignalTextDetailed(item: SignalSnapshot, historical = false, now = Date.now()) {
  const localTime = (time: number) => new Intl.DateTimeFormat("en-AU", {timeZone:"Australia/Melbourne", dateStyle:"medium", timeStyle:"short"}).format(time) + " Melbourne";
  const frame = item.executionPlan?.timeframe ?? STYLE_CONFIG[item.style].interval + "m";
  const status = historical ? notificationStatus(item, now) : "QUALIFIED · RECHECK LIVE BEFORE ENTRY";
  return [
    "📡 BOMA SCANS",
    (item.side === "LONG" ? "🟢 LONG / BUY" : "🔴 SHORT / SELL") + "  •  #" + item.symbol + "  •  " + frame,
    "📍 ENTRY  " + formatPrice(item.entry),
    "🛑 STOP LOSS  " + formatPrice(item.stop),
    "",
    "🎯 TAKE-PROFIT LADDER",
    ...item.targets.map(target => "🎯 TP" + target.level + "  " + formatPrice(target.price) + "  •  close " + target.exitPct + "%  •  " + target.rewardR.toFixed(2) + "R"),
    "",
    "⚖️ Leverage " + item.leverage + "×  •  stop-risk " + item.riskPct.toFixed(2) + "%",
    "🔔 " + status,
    "⏳ Entry deadline: " + localTime(item.expiresAt),
    historical ? "🗂️ ORIGINAL SAVED LEVELS · not a fresh entry approval" : "",
    "",
    "🧭 HOW TO ENTER",
    ...(item.executionPlan ? item.executionPlan.steps.map((step, index) => ["1️⃣", "2️⃣", "3️⃣", "4️⃣"][index] + " " + step)
      : ["⚠️ Refresh the chart for current confirmation and entry instructions."]),
    "",
    "🚪 HOW TO EXIT & PROTECT",
    "✅ Bank " + item.targets[0].exitPct + "% at TP1 and " + item.targets[1].exitPct + "% at TP2. These are the primary objectives; do not wait for every TP.",
    "🏃 TP3 takes " + item.targets[2].exitPct + "%; TP4/TP5 take " + item.targets[3].exitPct + "%/" + item.targets[4].exitPct + "% as runners. If price returns to TP1 after TP2, close the remainder; day runners also time out after 2h.",
    "🛡️ After TP1, tighten only behind later confirmed structure. Do not move automatically to breakeven.",
    "🛑 If the stop or invalidation is reached, exit the remainder. Confirm the actual fill on Bybit.",
    "",
    "🚫 CANCEL / DO NOT ENTER",
    item.executionPlan?.cancelText ?? "Cancel if the setup expires or fresh analysis fails.",
    "⛔ Do not chase a pump/dump, widen the stop or average down. A missed limit fill is a skipped trade.",
    item.needsAcknowledgement ? "⚠️ Reduced-size acknowledgement required for BTC caution or a quality override." : "",
    "",
    "🔎 WHY THIS SETUP",
    "🏅 " + item.grade + " " + item.rating + "/100  •  TA " + item.score + "/100  •  entry " + item.entryGrade + " " + item.entryQuality + "/100",
    "🧩 " + item.setupType + "  •  " + item.regime + "  •  " + item.riskBand + " relative risk",
    ...item.proof.map(proof => "✅ " + proof),
    "₿ BTC: " + item.btcRelationship + "  •  " + item.btcVerdict,
    item.btcExplanation ? "💬 " + item.btcExplanation : "",
    ...item.targets.map(target => "📐 TP" + target.level + " basis: " + target.source),
    "",
    "📊 24h volume " + (item.turnover ? "$" + compactNumber(item.turnover) : "n/a") + (item.btcDailyTrend && item.btcDailyTrend !== "UNKNOWN" ? "  •  BTC daily trend " + item.btcDailyTrend + (item.trendAligned === false ? " · AGAINST this trade: half size" : " · aligned") : ""),
    "💰 POSITION PLAN",
    "Risk " + item.riskAmount.toFixed(2) + " USDT  •  quantity " + item.quantity + "  •  estimated isolated margin " + item.margin.toFixed(2) + " USDT",
    "Weighted reward " + item.rewardR.toFixed(2) + "R  •  after estimated spread/fees/slippage " + item.netRewardR.toFixed(2) + "R, funding excluded",
    "🕒 " + item.style + "  •  " + item.flexibility + "  •  " + localTime(item.createdAt),
    "📄 Advisory only. No exchange order has been placed. Place and monitor protective orders on Bybit yourself. Ratings are not win probabilities.",
  ].filter((line,index,array) => line || (index > 0 && array[index-1])).join("\n");
}

export type CompactSignalInput = {
  symbol: string; side: "LONG" | "SHORT"; entryLow: number; entryHigh: number; entry: number;
  trigger?: number; timeframe?: string; leverage?: number; stop: number;
  targets: Array<{ price: number; available?: boolean }>; expiresAt?: number;
};

/** The short signal card: coin, side, entry zone, trigger rule, leverage, targets, stop, validity. */
export function compactSignalLines(input: CompactSignalInput): string[] {
  const long = input.side === "LONG";
  const melbourne = (time: number) => new Intl.DateTimeFormat("en-AU", {timeZone: "Australia/Melbourne", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false}).format(time);
  const sign = long ? 1 : -1;
  const risk = Math.max(Math.abs(input.entry - input.stop), input.entry * 0.0001);
  const pct = (price: number) => (sign * (price - input.entry) / input.entry * 100);
  const figures = (price: number) => "   " + (pct(price) >= 0 ? "+" : "") + pct(price).toFixed(2) + "%  ·  " + (sign * (price - input.entry) / risk).toFixed(1) + "R";
  return [
    "📍 Coin : #" + input.symbol.replace(/USDT$/, "") + "/USDT",
    long ? "🟢 LONG" : "🔴 SHORT",
    "👉 Entry: " + formatPrice(long ? input.entryHigh : input.entryLow) + " - " + formatPrice(long ? input.entryLow : input.entryHigh) + " · " + (long ? "BUY" : "SELL") + " LIMIT " + formatPrice(input.entry),
    ...(input.trigger ? ["🎯 Trigger: " + formatPrice(input.trigger) + " (" + (long ? "close above" : "close below") + (input.timeframe ? ", " + input.timeframe : "") + ")"] : []),
    ...(input.leverage ? ["🌐 Leverage: " + input.leverage + "x"] : []),
    "",
    ...input.targets.map((target, index) => "🎯 Target " + (index + 1) + ": " + (target.available === false ? "unconfirmed" : formatPrice(target.price) + figures(target.price))),
    "",
    "❌ StopLoss: " + formatPrice(input.stop) + "   −" + (Math.abs(input.entry - input.stop) / input.entry * 100).toFixed(2) + "%",
    ...(input.expiresAt ? ["⏱ Expires: " + melbourne(input.expiresAt)] : []),
  ];
}

export function appLink(origin: string, symbol: string) { return origin.replace(/\/$/, "") + "/?pair=" + symbol; }

export function telegramSignalText(item: SignalSnapshot, historical = false, now = Date.now(), link?: string) {
  const plan = item.executionPlan;
  const lines = compactSignalLines({
    symbol: item.symbol, side: item.side, entryLow: plan?.entryLow ?? item.entry, entryHigh: plan?.entryHigh ?? item.entry, entry: item.entry,
    trigger: plan?.trigger, timeframe: plan?.timeframe, leverage: item.leverage, stop: item.stop, targets: item.targets, expiresAt: item.expiresAt,
  });
  const status = historical ? "🗂️ Saved levels · " + notificationStatus(item, now) : "✅ " + item.grade + " " + item.rating + "/100 · " + item.setupType + " · " + item.style + " " + item.flexibility;
  return [...lines, status, ...(link ? ["🔗 Open in app: " + link] : []), "📄 Advisory only. No exchange order has been placed."].join("\n");
}

/**
 * Telegram HTML renderer shared by signals and monitor messages: bold title
 * and side, a blank line between groups, prices in monospace, the link last.
 */
export function renderTelegramHtml(lines: string[]) {
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  // Monospace the price part of a line (before the spaced figures), never percentages.
  const mono = (text: string) => { const [head, ...rest] = text.split("   "); return head.replace(/(?<![\w.])(\d+\.\d+|\d{2,})(?![\w.%])/g, "<code>$1</code>") + (rest.length ? "   " + rest.join("   ") : ""); };
  const spaced: string[] = [];
  const isGroupStart = (line: string) => /^(📍 Price|👉 Entry|🎯 Target 1:|❌ StopLoss|⏱ Expires|🔗 |✅ |⏳ |⛔ |⏸ |📄 |🗂️|➡️|🏁)/u.test(line);
  lines.forEach((line, index) => {
    const previous = spaced[spaced.length - 1];
    const sideLine = /^(🟢 LONG|🔴 SHORT)/u.test(line);
    if (index > 0 && line !== "" && previous !== "" && previous !== undefined && !sideLine && (index === 1 || isGroupStart(line) || /^(🟢 LONG|🔴 SHORT)/u.test(previous))) spaced.push("");
    if (line === "" && previous === "") return;
    spaced.push(line);
  });
  return spaced.map((line, index) => {
    const safe = escape(line.slice(0, 2600));
    if (index === 0 || /^(📍 Coin|🟢 LONG|🔴 SHORT)/u.test(line)) return "<b>" + safe + "</b>";
    if (/^(📍 Price|👉 Entry|🎯 Trigger|🎯 Target \d|❌ StopLoss|🌐 Leverage|⏱ Expires|🛑 Stop)/u.test(line)) return mono(safe);
    if (/^🔗 /u.test(line)) return "<i>" + safe + "</i>";
    return safe;
  }).join("\n");
}

/** Telegram HTML keeps important levels prominent; copy/export remains plain text. */
export function telegramSignalHtml(item: SignalSnapshot, historical = false, now = Date.now(), link?: string) {
  return renderTelegramHtml(telegramSignalText(item, historical, now, link).split("\n"));
}

/** A short, quiet two-note chime. Context activation is handled by a user click. */
/** Distinct three-note rising chime for "price reached the trigger / entry range". */
export function playTriggerChime(context: AudioContext, volume: number) {
  if (context.state !== "running" || volume <= 0) return false;
  const level = Math.min(1, Math.max(0, volume)) * 0.16;
  [523, 659, 784, 1047].forEach((frequency, index) => {
    const start = context.currentTime + index * 0.11;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + 0.22);
  });
  return true;
}

export function playSetupChime(context: AudioContext, volume: number) {
  if (context.state !== "running" || volume <= 0) return false;
  const level = Math.min(1, Math.max(0, volume)) * 0.14;
  [660, 880].forEach((frequency, index) => {
    const start = context.currentTime + index * 0.17;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + 0.26);
  });
  return true;
}
