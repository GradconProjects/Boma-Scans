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
