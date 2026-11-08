import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/push-policy.ts", import.meta.url).pathname;
const mod = new Module(file); mod.require = require;
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { majorEventGate, whaleStance } = mod.exports;

test("Push gate: a major event, a two-ATR stop and four quiet hours let an entry through; otherwise it is held with reasons", () => {
  const row = { bias: "LONG", setupType: "PULLBACK", stop: 95, entry: 100, executionPlan: { entry: 100 } };
  const analysis = (structure) => ({ structure, metrics: { atr: 2 } });
  const calm = Array.from({ length: 30 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  const ok = majorEventGate(row, analysis({ bos: "BULLISH", choch: "NONE", sweep: "NONE" }), calm);
  assert.equal(ok.ok, true); assert.match(ok.event, /break of structure long/); assert.ok(ok.survivalHours >= 4);
  const noEvent = majorEventGate(row, analysis({ bos: "NONE", choch: "NONE", sweep: "NONE" }), calm);
  assert.equal(noEvent.ok, false); assert.match(noEvent.reasons[0], /no major structural event/);
  const tight = majorEventGate({ ...row, stop: 98 }, analysis({ bos: "BULLISH", choch: "NONE", sweep: "NONE" }), calm);
  assert.equal(tight.ok, false); assert.match(tight.reasons[0], /four-hour hold needs about 2 ATR/);
  const wicky = majorEventGate(row, analysis({ bos: "BULLISH", choch: "NONE", sweep: "NONE" }), [...calm.slice(0, -3), { time: 1, open: 100, high: 101, low: 95.5, close: 100, volume: 1 }, ...calm.slice(-2)]);
  assert.equal(wicky.ok, false); assert.match(wicky.reasons[0], /within 20% of the stop/);
  assert.equal(majorEventGate({ ...row, setupType: "BREAKOUT" }, analysis({ bos: "NONE", choch: "NONE", sweep: "NONE" }), calm).event, "breakout setup");
});

test("Whale stance: fresh flow decides first, then the open book; small or split data is neutral", () => {
  assert.equal(whaleStance("LONG", { longUsd: 0, shortUsd: 0 }, { longUsd: 2e6, shortUsd: 1e5 }).stance, "WITH");
  assert.equal(whaleStance("LONG", { longUsd: 9e6, shortUsd: 1e6 }, { longUsd: 1e5, shortUsd: 1.5e6 }).stance, "AGAINST", "fresh money against outranks an old long book");
  assert.equal(whaleStance("SHORT", { longUsd: 1e6, shortUsd: 8e6 }, { longUsd: 0, shortUsd: 0 }).stance, "WITH");
  assert.equal(whaleStance("SHORT", { longUsd: 1e5, shortUsd: 1e5 }, { longUsd: 0, shortUsd: 0 }).stance, "NEUTRAL");
});
