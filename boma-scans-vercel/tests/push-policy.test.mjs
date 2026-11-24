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

test("Trading window: Monday and Tuesday (Melbourne) are the caution days; the hour no longer matters; ALL mode opens everything", () => {
  const { tradingWindowGate, melbourneClock } = mod.exports;
  // 2026-11-18 is a Wednesday. 21:00 Melbourne (AEDT, UTC+11) = 10:00 UTC the same day.
  const wedEvening = Date.UTC(2026, 10, 18, 10, 0);
  assert.equal(melbourneClock(wedEvening).label, "Wed 21:00 Melbourne");
  assert.equal(tradingWindowGate(wedEvening).ok, true);
  const wedDeadZone = Date.UTC(2026, 10, 17, 19, 0); // 06:00 Wed Melbourne
  assert.equal(tradingWindowGate(wedDeadZone).ok, true, "the 03:00–10:00 rule was not confirmed by the three-year test and is dropped");
  const monday = Date.UTC(2026, 10, 16, 10, 0); // Mon 21:00 Melbourne
  assert.equal(tradingWindowGate(monday).ok, false); assert.match(tradingWindowGate(monday).reason, /Monday and Tuesday/);
  assert.equal(tradingWindowGate(monday, "ALL").ok, true);
});

test("Evidence flags: brief, information only, one sentence each", () => {
  const { evidenceFlags, evidenceFlagLines, windowVerdict } = mod.exports;
  const monday = Date.UTC(2026, 10, 16, 10, 0), thursday = Date.UTC(2026, 10, 19, 10, 0);
  const f = evidenceFlags({ side: "LONG", at: monday, majorEvent: false, rating: 2 });
  assert.equal(f.length, 4); assert.match(f[0], /^🚩 Monday \(Melbourne\)/); assert.match(f[1], /^🚩 LONG/); assert.match(f[2], /^🚩 No major event/); assert.match(f[3], /^🚩 Low rating \(2\/10\)/);
  assert.deepEqual(evidenceFlags({ side: "SHORT", at: thursday }), [], "nothing to flag");
  assert.match(evidenceFlags({ side: "SHORT", at: thursday, majorEvent: true })[0], /^✅ Major event present/);
  assert.deepEqual(evidenceFlagLines({ side: "SHORT", at: thursday }), []); assert.match(evidenceFlagLines({ side: "LONG", at: thursday })[1], /information only, nothing is blocked/);
  assert.equal(windowVerdict(monday).title, "CAUTION DAY"); assert.match(windowVerdict(monday).detail, /^Flag only, nothing is blocked/); assert.equal(windowVerdict(thursday).good, true); assert.ok(!windowVerdict(thursday).detail.includes("69%"));
});
