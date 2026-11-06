import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/trigger-monitor.ts", import.meta.url).pathname;
const mod = new Module(file); mod.require = require;
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { evaluateMonitor, parseMonitoredSymbols } = mod.exports;
const plan = (side, status = "WAIT_CONFIRMATION") => ({ side, status, trigger: 100, entryLow: side === "LONG" ? 100 : 99, entryHigh: side === "LONG" ? 101 : 100, zoneSource: "FVG", timeframe: "1h", confirmationTime: null });
const row = (side, ready = false, status) => ({ symbol: "ABCUSDT", bias: side, stop: side === "LONG" ? 95 : 105, entryReady: ready, executionPlan: plan(side, status) });

test("Monitor states: waiting, at trigger, entry range, stop hit, no plan", () => {
  assert.equal(evaluateMonitor("ABCUSDT", undefined, 100).state, "NO PLAN");
  assert.equal(evaluateMonitor("ABCUSDT", row("LONG"), undefined).state, "WAITING");
  assert.equal(evaluateMonitor("ABCUSDT", row("LONG"), 99).state, "WAITING");
  assert.equal(evaluateMonitor("ABCUSDT", row("LONG"), 100.5).state, "AT TRIGGER", "crossed but plan not READY");
  assert.equal(evaluateMonitor("ABCUSDT", row("LONG", true, "READY"), 100.5).state, "ENTRY RANGE");
  assert.equal(evaluateMonitor("ABCUSDT", row("LONG", true, "READY"), 102).state, "AT TRIGGER", "beyond the no-chase bound is not an entry");
  assert.equal(evaluateMonitor("ABCUSDT", row("LONG"), 94).state, "STOP HIT");
  assert.equal(evaluateMonitor("ABCUSDT", row("SHORT"), 99.5).state, "AT TRIGGER");
  assert.equal(evaluateMonitor("ABCUSDT", row("SHORT", true, "READY"), 99.5).state, "ENTRY RANGE");
  assert.equal(evaluateMonitor("ABCUSDT", row("SHORT"), 106).state, "STOP HIT");
  const far = evaluateMonitor("ABCUSDT", row("LONG"), 95.5);
  assert.ok(far.toTriggerPct > 4 && far.toTriggerPct < 5);
  assert.notEqual(evaluateMonitor("ABCUSDT", row("LONG"), 99).planKey, evaluateMonitor("ABCUSDT", { ...row("LONG"), executionPlan: { ...plan("LONG"), trigger: 101 } }, 99).planKey);
});
test("Monitored symbols are validated and de-duplicated", () => {
  assert.deepEqual(parseMonitoredSymbols(["BTCUSDT", "btc", "BTCUSDT", "ETHUSDT", 5, "X"]), ["BTCUSDT", "ETHUSDT"]);
  assert.deepEqual(parseMonitoredSymbols("nope"), []);
});
test("Armed plans track target hits in order and stop first, with the exit percentages", () => {
  const { armPlan, checkExits, parseArmedPlans } = mod.exports;
  const row = { symbol: "ABCUSDT", bias: "LONG", stop: 95, entryReady: true, executionPlan: { side: "LONG", trigger: 100, stop: 95, entry: 100.2, confirmationTime: 7 }, takeProfits: [101, 102, 103, 104, 105].map((price, i) => ({ price, exitPct: [30, 25, 20, 15, 10][i] })) };
  const plan = armPlan(row, 1000);
  assert.equal(plan.entry, 100.2); assert.equal(plan.hit, 0); assert.deepEqual(plan.weights, [30, 25, 20, 15, 10]);
  let step = checkExits(plan, 100.5); assert.deepEqual(step.events, []); assert.equal(step.next.hit, 0);
  step = checkExits(step.next, 102.3);
  assert.deepEqual(step.events.map(e => [e.kind, e.level, e.exitPct]), [["TARGET", 1, 30], ["TARGET", 2, 25]]);
  assert.equal(step.next.hit, 2);
  step = checkExits(step.next, 101); assert.deepEqual(step.events, [], "no repeat after a pullback");
  step = checkExits(step.next, 94.9); assert.equal(step.events[0].kind, "STOP"); assert.equal(step.next, null);
  const done = checkExits({ ...plan, hit: 4 }, 105.1); assert.equal(done.events[0].level, 5); assert.equal(done.next, null, "all targets done");
  const short = checkExits({ ...plan, side: "SHORT", stop: 105, targets: [99, 98, 97, 96, 95] }, 97.5);
  assert.deepEqual(short.events.map(e => e.level), [1, 2]);
  assert.equal(parseArmedPlans([plan, { bad: true }]).length, 1);
});
