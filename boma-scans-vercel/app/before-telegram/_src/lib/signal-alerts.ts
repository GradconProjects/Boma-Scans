import { INTERVAL_MS, STYLE_CONFIG, formatPrice, type ScannerRow, type TakeProfitLevel } from "@/app/before-telegram/_src/lib/market";
import { isMediumRiskTake, type MediumRiskRecommendation } from "@/app/before-telegram/_src/lib/recommendations";
import { restoreEntryExecutionPlan, type EntryExecutionPlan } from "@/app/before-telegram/_src/lib/entry-execution";

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
    needsAcknowledgement: row.btcRelationship.divergenceVerdict === "CAUTION" || row.qualityOverride.eligible,
    proof: row.entryChecks.filter(check => check.required && check.status === "PASS").map(check => check.label),
  };
}

/** Run only on a completed live scan, never on partial results or price ticks. */
export function reconcileSignals(ledger: SignalLedger, picks: MediumRiskRecommendation[], scope: string, scanAt: number, now: number) {
  const previous = ledger.scopes[scope];
  if (now < scanAt || (previous && previous.at >= scanAt)) return {ledger, added: [] as SignalSnapshot[]};
  const qualified = picks.filter(pick => signalScope(pick.row) === scope && isMediumRiskTake(pick.row, true, now) && pick.quantity > 0 && pick.leverage > 0 && pick.row.takeProfits.length === 5 && pick.row.takeProfits.every(target => target.available));
  // A continuing setup stays quiet across scans/reloads; a new episode or a long
  // absence can alert again. A six-hour absence is not treated as continuity.
  const previousKeys = new Set(previous && now - previous.at <= 6 * 3_600_000 ? previous.keys : []);
  const currentKeys = new Set(qualified.map(pick => signalKey(pick.row)));
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
        typeof item.symbol === "string" && /^[A-Z0-9]{1,24}USDT$/.test(item.symbol) &&
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

export function telegramSignalText(item: SignalSnapshot, historical = false, now = Date.now()) {
  const stamp = new Date(item.createdAt).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const status = historical ? notificationStatus(item, now) : "QUALIFIED SCAN · RECHECK LIVE CHART";
  return [
    "📡 BOMA SCANS | TRADE SETUP",
    (item.side === "LONG" ? "🟢 LONG" : "🔴 SHORT") + " • #" + item.symbol + " • Bybit USDT perpetual",
    "🔔 " + status,
    "🕒 " + item.style + " · " + STYLE_CONFIG[item.style].interval + (Number.isFinite(Number(STYLE_CONFIG[item.style].interval)) ? "m" : "") + " · " + item.flexibility + " · " + stamp,
    "🏅 Rating " + item.grade + " " + item.rating + "/100 · TA " + item.score + "/100 · Entry " + item.entryGrade + " " + item.entryQuality + "/100",
    "🛡️ Relative risk " + item.riskBand + " · " + item.setupType + " · " + item.regime,
    "", "📍 Entry: " + formatPrice(item.entry), "🛑 Stop loss: " + formatPrice(item.stop), "",
    ...(item.executionPlan ? [
      "🧭 HOW TO ENTER — recheck the live chart first",
      ...item.executionPlan.steps.map((step, index) => ["1️⃣", "2️⃣", "3️⃣", "4️⃣"][index] + " " + step),
      "🚫 " + item.executionPlan.cancelText, "",
    ] : ["⚠️ Older alert: refresh the chart for current entry instructions."]),
    ...item.targets.map(target => "🎯 TP" + target.level + ": " + formatPrice(target.price) + " · " + target.rewardR.toFixed(2) + "R · close " + target.exitPct + "% · " + target.source),
    "", "⚖️ Suggested leverage: " + item.leverage + "× · account stop-risk " + item.riskPct.toFixed(2) + "%",
    "💵 Risk " + item.riskAmount.toFixed(2) + " USDT · quantity " + item.quantity + " · estimated isolated margin " + item.margin.toFixed(2) + " USDT",
    "📐 Weighted reward " + item.rewardR.toFixed(2) + "R · after spread " + item.netRewardR.toFixed(2) + "R (before fees/funding)",
    "₿ BTC: " + item.btcRelationship + " · " + item.btcVerdict,
    "✅ " + item.proof.join(" · "),
    item.needsAcknowledgement ? "⚠️ Reduced-size acknowledgement required for BTC caution or a quality override." : "",
    "⏳ Snapshot expires " + new Date(item.expiresAt).toISOString().slice(11,19) + " UTC. Recheck current price, portfolio limits and the chart before entry.",
    historical ? "🗂️ Saved notification: these are the original levels, not a fresh entry approval." : "",
    "📄 Advisory signal. No exchange order has been placed. Ratings are not win probabilities.",
  ].filter((line,index,array) => line || (index > 0 && array[index-1])).join("\n");
}

/** A short, quiet two-note chime. Context activation is handled by a user click. */
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
