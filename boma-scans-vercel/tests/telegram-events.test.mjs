import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const modules = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file).exports;
  const mod = new Module(file); modules.set(file, mod);
  mod.require = spec => spec.startsWith("@/") ? load(spec.slice(2) + ".ts") : require(spec);
  mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return mod.exports;
}
const { formatMonitorEvent, formatTradeEvent } = load("app/lib/telegram-events.ts");
const plan = { side: "LONG", status: "READY", trigger: 100, entryLow: 100, entryHigh: 101, entry: 100.2, zoneSource: "FVG", timeframe: "1h", confirmationTime: 1 };
test("Monitor events carry exact levels and the right instruction per state", () => {
  const base = { symbol: "ABCUSDT", side: "LONG", price: 100.5, toTriggerPct: -0.5, plan, stop: 95, ready: true, planKey: "ABCUSDT:LONG:100:95:1" };
  const range = formatMonitorEvent({ ...base, state: "ENTRY RANGE" });
  assert.equal(range.key, "monitor:ABCUSDT:LONG:100:95:1:ENTRY RANGE");
  assert.match(range.lines.join("\n"), /BUY LIMIT 100\.2/);
  assert.match(range.lines.join("\n"), /READY and price is inside/);
  assert.match(formatMonitorEvent({ ...base, state: "AT TRIGGER" }).lines.join("\n"), /candle to CLOSE above/);
  assert.match(formatMonitorEvent({ ...base, state: "STOP HIT" }).lines.join("\n"), /invalidated/);
  assert.equal(formatMonitorEvent({ ...base, plan: null }), null);
});
test("Trade follow-ups fire only for actionable advice and key by trade, action and level", () => {
  const trade = { id: "t1", symbol: "ABCUSDT", side: "SHORT", mode: "PAPER", stop: 105 };
  const snapshot = { action: "TAKE PARTIAL", severity: "positive", headline: "TP1 reached", detail: "Take 30%", currentPrice: 98, rMultiple: 1.02, exitLevel: 1, stale: false };
  const event = formatTradeEvent(trade, snapshot);
  assert.equal(event.key, "trade:t1:TAKE PARTIAL:1");
  assert.match(event.lines[0], /TAKE PARTIAL TP1/);
  assert.equal(formatTradeEvent(trade, { ...snapshot, action: "HOLD TO PLAN" }), null);
});
test("Monitoring-start message lists the levels and keys per plan and minute", () => {
  const { formatMonitorStart } = load("app/lib/telegram-events.ts");
  const entry = { symbol: "ABCUSDT", side: "SHORT", state: "WAITING", price: 101, toTriggerPct: 0.99, plan: { ...plan, side: "SHORT", entryLow: 99, entryHigh: 100, entry: 99.8 }, stop: 105, ready: false, planKey: "ABCUSDT:SHORT:100:105:0" };
  const event = formatMonitorStart(entry, 120_000);
  assert.equal(event.key, "monitor:ABCUSDT:SHORT:100:105:0:start:2");
  assert.match(event.lines.join("\n"), /SELL LIMIT 99\.8/);
  assert.match(event.lines.join("\n"), /\+0\.99% to trigger/);
  assert.match(formatMonitorStart({ ...entry, plan: null }).lines.join("\n"), /No scanned plan yet/);
});
test("Monitor updates and the hourly digest have stable keys and clear text", () => {
  const { formatMonitorUpdate, formatMonitorDigest } = load("app/lib/telegram-events.ts");
  const entry = { symbol: "DGAIUSDT", side: "SHORT", state: "AT TRIGGER", price: 0.7594, toTriggerPct: -0.65, plan: { ...plan, side: "SHORT", trigger: 0.76432, entryLow: 0.75822, entryHigh: 0.76432, entry: 0.76, zoneSource: "ORDER BLOCK" }, stop: 0.78872, ready: true, planKey: "DGAIUSDT:SHORT:0.76432:0.78872:1" };
  assert.equal(formatMonitorUpdate(entry, "CONFIRMED").key, "monitor:DGAIUSDT:SHORT:0.76432:0.78872:1:CONFIRMED");
  assert.match(formatMonitorUpdate(entry, "PLAN UPDATED").lines.join("\n"), /Cancel any resting order/);
  assert.match(formatMonitorUpdate(entry, "EXPIRED").lines[0], /EXPIRED/);
  const digest = formatMonitorDigest([entry, { ...entry, symbol: "ABCUSDT", plan: null, state: "NO PLAN" }], 7_200_000);
  assert.equal(digest.key, "monitor:digest:2");
  assert.match(digest.lines[1], /DGAIUSDT SHORT · AT TRIGGER · price 0\.7594\d* · trigger 0\.76432\d* \(-0\.65%\)/);
  assert.match(digest.lines[2], /ABCUSDT · no plan/);
  assert.equal(formatMonitorDigest([]), null);
});
