/**
 * What may be pushed to Telegram. One rule, enforced where every scheduled message is sent.
 *
 * ENTRIES_ONLY (the default): only confirmed entry calls go out, plus messages about a trade the owner said they entered
 * and confirmations of the owner's own taps. Whale activity, whale exits on trades the owner is not in, watch-list moves,
 * check-ins and digests are not sent.
 */
export type TelegramMode = "ENTRIES_ONLY" | "EVERYTHING";
export type PolicyContext = { mode: TelegramMode; /** Coins the owner marked as entered in the whale section. */ enteredCoins: string[] };
export type PolicyDecision = { send: boolean; kind: string; reason: string };

const ENTRY_KINDS: Array<[RegExp, string]> = [
  [/^signal:/, "Scanner confirmed entry"],
  [/^whale:signal:/, "Whale confirmed entry"],
  [/^ws2:ready:/, "Whale System 2 entry ready"],
];
const OWN_TRADE_KINDS: Array<[RegExp, string]> = [
  [/^exit:/, "target, stop or close on a trade you entered"],
  [/^advice:/, "management advice on a trade you entered"],
  [/^whale:warn:/, "whale move against a trade you entered"],
  [/^whale:entered:/, "confirmation that your entry was recorded"],
  [/^whale:exited:/, "confirmation that your exit was recorded"],
  [/^monitor:whale-analysis:/, "analysis you sent yourself from the app"],
];

export function telegramDecision(key: string, context: PolicyContext): PolicyDecision {
  const entry = ENTRY_KINDS.find(([re]) => re.test(key)); if (entry) return { send: true, kind: entry[1], reason: "confirmed entry" };
  const own = OWN_TRADE_KINDS.find(([re]) => re.test(key)); if (own) return { send: true, kind: own[1], reason: "about your own trade or action" };
  if (context.mode === "EVERYTHING") return { send: true, kind: "other", reason: "all messages are switched on" };
  // A whale exit matters only when the owner is in that coin.
  const exit = key.match(/^whale:exit:([^:]+):/);
  if (exit) return context.enteredCoins.includes(exit[1]) ? { send: true, kind: "whales leaving a trade you entered", reason: "about your own trade" } : { send: false, kind: "whale exit", reason: "you are not in this trade" };
  if (/^whale:event:/.test(key)) return { send: false, kind: "whale activity", reason: "not an entry call" };
  if (/^whale:watch:/.test(key)) return { send: false, kind: "watch-list move", reason: "not an entry call" };
  if (/^whale:checkin:/.test(key)) return { send: false, kind: "check-in", reason: "not an entry call" };
  if (/^monitor:digest:/.test(key) || /^forming:/.test(key)) return { send: false, kind: "digest or forming setup", reason: "not a confirmed entry" };
  // The monitor only produces these for pairs the owner entered (trigger, entry range, stop, expiry on an armed plan).
  if (/^monitor:/.test(key)) return { send: true, kind: "update on a pair you entered", reason: "about your own trade" };
  return { send: false, kind: "other", reason: "not a confirmed entry" };
}
