import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/ws2/engine.ts", import.meta.url).pathname;
const mod = new Module(file); mod.require = require;
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { runWs2, ws2Lines, percentile } = mod.exports;

const H = 3_600_000; const NOW = Date.UTC(2026, 10, 24, 16, 0, 0);
/** Candles from a list of closes; each candle's open is the previous close. */
const series = (closes, stepMs, vol = () => 1000, wick = 0.003) => closes.map((close, i) => { const open = i ? closes[i - 1] : close; return { time: NOW - (closes.length - i) * stepMs, open, high: Math.max(open, close) * (1 + wick), low: Math.min(open, close) * (1 - wick), close, volume: vol(i, closes.length) }; });
const wobble = (i) => Math.sin(i / 3) * 0.004;
const settings = { equity: 10000, riskPct: 0.5, leverage: 5, feePct: 0.055, slippagePct: 0.02 };

/** NEAR as captured: -11% in 24 h to 2.818, selling volume fading at the end. */
function nearInput() {
  const flat = Array.from({ length: 276 }, (_, i) => 3.17 * (1 + wobble(i)));
  const fall = Array.from({ length: 24 }, (_, i) => 3.17 - (3.17 - 2.818) * Math.pow((i + 1) / 24, 0.8));
  const h1 = series([...flat, ...fall], H, (i, n) => i >= n - 3 ? 900 : i >= n - 24 ? 4000 : 1000);
  const m15 = series(Array.from({ length: 96 }, (_, i) => 2.9 - 0.082 * (i / 95) + (i % 2 ? 0.004 : -0.004)), H / 4);
  const h4 = series(Array.from({ length: 120 }, (_, i) => i < 114 ? 3.2 * (1 + wobble(i)) : 3.2 - (3.2 - 2.818) * ((i - 113) / 6)), 4 * H);
  const d1 = series(Array.from({ length: 90 }, (_, i) => i < 89 ? 3.25 * (1 + wobble(i) * 3) : 2.818), 24 * H, () => 1000, 0.02);
  return {
    coin: "NEAR", symbol: "NEARUSDT", at: NOW, price: 2.818, candles: { m15, h1, h4, d1 }, btc: null,
    chart: { bias: "SHORT", regime: "TRENDING", trendFrames: 3, planStatus: "WAIT_RETEST", bos: "BEARISH", choch: "NONE", sweep: "NONE", btcCorrelation: null, btcBeta: null },
    // Coin-unit open interest +0.18% over 24 h (USD fell ~11% only because price fell).
    oi: { series: Array.from({ length: 200 }, (_, i) => ({ t: NOW - (200 - i) * H, coins: 31_900_000 * (i < 176 ? 1 : 1 + 0.0018 * ((i - 175) / 24)) })) },
    funding: { current: -0.00002262, intervalHours: 4, history: Array.from({ length: 120 }, (_, i) => 0.00005 * Math.sin(i / 5)), at: NOW - 45 * 60_000, other: [{ source: "scanner display", value: 0.00005, at: null }] },
    taker: null,
    // Bybit accounts ~67% long and unchanged for weeks: normal for this coin.
    bybitAccounts: { series: Array.from({ length: 480 }, (_, i) => ({ t: NOW - (480 - i) * H, longShare: 0.67 + Math.sin(i / 7) * 0.012 })) },
    venues: { binanceTopPositions: 0.62, okxTopPositions: 0.51, binanceAccounts: 0.57, okxAccounts: 0.64 },
    whales: null, // "Strong SHORT, exact exposure not supplied": must not be invented
    liquidations: { usd: 3_990_000, longShare: 0.95, timestamped: false },
    settings,
  };
}

test("NEAR regression: bearish bias is recognised but the short is not approved", () => {
  const r = runWs2(nearInput());
  // 1. Bearish positioning recognised.
  assert.ok(r.scores.bearishBias > r.scores.bullishBias, "bearish evidence leads");
  assert.equal(r.side, "SHORT");
  // 2. Institutions do not clearly support the short; populations are not averaged into "56% long".
  assert.match(r.institutions.verdict, /does not support shorts/);
  assert.ok(!r.institutions.lines.join(" ").includes("56%"));
  // 3. Unchanged retail crowding is not counted as growing squeeze fuel.
  assert.match(r.retail.verdict, /NORMAL for this coin/); assert.match(r.retail.lines.join(" "), /unchanged: crowding is not building/);
  assert.equal(r.components.find(c => c.key === "retail").bear, 0);
  // 4. Falling USD open interest is not read as contracts closing.
  assert.ok(r.oi.usdChange24h < -0.09 && Math.abs(r.oi.coinChange24h) < 0.01); assert.match(r.oi.read, /most of the USD change is the price move/);
  // 5. Late-stage liquidation / exhaustion risk detected.
  assert.ok(r.scores.exhaustion >= 60, "exhaustion " + r.scores.exhaustion); assert.match(r.squeeze.long.stage, /LATE-STAGE|EXHAUSTION/);
  assert.match(r.exhaustion.parts.join(" "), /95% of .* reported liquidations were longs/);
  // 6. Funding discrepancy is flagged, not silently merged.
  assert.match(r.fundingRead.lines.join(" "), /Discrepancy: scanner display shows 0.0050%/); assert.match(r.fundingRead.verdict, /ORDINARY/);
  // 7. Missing whale exposure is not invented.
  assert.equal(r.whales.verdict, "UNAVAILABLE"); assert.equal(r.components.find(c => c.key === "whales").available, false);
  // 8. Normal position size is not approved.
  assert.match(r.sizing, /^NOT AUTHORISED/);
  // 9 + 10. Bias is separate from entry readiness: the status is a qualified wait.
  assert.ok(["CHASING RISK", "AWAITING PULLBACK", "AWAITING CONFIRMATION"].includes(r.status), r.status);
  assert.notEqual(r.status, "ENTRY READY");
  assert.match(r.activate[0], /relief rally/);
  // Scores are independent and not complementary.
  assert.notEqual(r.scores.bullishBias + r.scores.bearishBias, 100);
  assert.match(r.scoreNote, /UNCALIBRATED HEURISTIC/);
  assert.ok(ws2Lines(r).join("\n").includes("WHALE SYSTEM 2 · NEAR"));
  for (const lv of [r.levels.pullback, r.levels.market]) { assert.equal(lv.targets.length, 5, "always five targets"); assert.ok(lv.targets.every((t, i) => i === 0 || t.r > lv.targets[i - 1].r), "targets in order"); assert.ok(lv.stop > lv.entry, "a short's stop is above its entry"); }
});

test("Flat market with no evidence is NO TRADE or WATCHING, and both sides score low", () => {
  const flat = Array.from({ length: 300 }, (_, i) => 100 * (1 + wobble(i) * 0.3));
  const base = nearInput();
  const r = runWs2({ ...base, coin: "FLAT", price: last(flat), candles: { h1: series(flat, H), m15: series(flat.slice(-96), H / 4), h4: series(flat.slice(-120), 4 * H), d1: series(flat.slice(-90), 24 * H) }, chart: null, venues: {}, bybitAccounts: null, funding: null, oi: null, liquidations: null });
  assert.ok(["NO TRADE", "WATCHING", "DATA UNAVAILABLE"].includes(r.status), r.status);
  assert.equal(r.side, null); assert.equal(r.scores.opportunity, 0);
  assert.ok(r.scores.bullishBias < 35 && r.scores.bearishBias < 35, "both directions can be poor at once");
});
const last = a => a[a.length - 1];

test("Missing data lowers reliability and never adds directional score", () => {
  const full = runWs2(nearInput());
  const bare = runWs2({ ...nearInput(), venues: {}, bybitAccounts: null, funding: null, oi: null, liquidations: null });
  assert.ok(bare.scores.reliability < full.scores.reliability);
  assert.ok(bare.scores.bearishBias <= full.scores.bearishBias, "weight of missing inputs is not redistributed");
  for (const key of ["top", "retail", "funding", "flow"]) { const c = bare.components.find(x => x.key === key); assert.equal(c.available, false); assert.equal(c.bull + c.bear, 0); assert.match(c.note, /UNAVAILABLE/); }
  const none = runWs2({ ...nearInput(), candles: { m15: [], h1: [], h4: [], d1: [] }, price: null });
  assert.equal(none.status, "DATA UNAVAILABLE");
});

test("Top traders on different exchanges disagreeing give no directional score", () => {
  const r = runWs2({ ...nearInput(), venues: { binanceTopPositions: 0.66, okxTopPositions: 0.38 } });
  assert.match(r.institutions.verdict, /^DISAGREE/); const c = r.components.find(x => x.key === "top"); assert.equal(c.bull, 0); assert.equal(c.bear, 0);
});

test("An established, profitable whale short is flagged as an old call, and new money counts more", () => {
  const flows = (l, s) => ({ longUsd: l, shortUsd: s });
  const r = runWs2({ ...nearInput(), whales: { bookLong: 1e6, bookShort: 4e7, positions: 9, avgEntryLong: 2.9, avgEntryShort: 3.6, pnlLong: -5e4, pnlShort: 8e6, topShare: 0.3, flows: { m15: flows(0, 0), h1: flows(0, 0), h4: flows(0, 0), h24: flows(0, 0) }, reduced24: flows(0, 2e6) } });
  assert.match(r.whales.verdict, /NO NEW EXPOSURE/); assert.match(r.whales.lines.join(" "), /Not an endorsement of a new short/);
  assert.ok(r.components.find(x => x.key === "whales").bear <= 0.2, "old profitable book carries little weight");
  assert.equal(percentile([1, 2, 3], 2), null, "too little history gives no percentile");
});

test("A confirmed pullback in an uptrend can become ENTRY READY with risk-based size", () => {
  const up = Array.from({ length: 300 }, (_, i) => 50 + i * 0.06 + Math.sin(i / 4) * 0.25);
  const h1 = series(up, H); const px = last(up);
  const m15 = series(Array.from({ length: 96 }, (_, i) => px - 0.6 + i * 0.00625 + (i % 2 ? 0.01 : 0)), H / 4);
  const r = runWs2({ ...nearInput(), coin: "UP", symbol: "UPUSDT", price: px, candles: { h1, m15, h4: series(Array.from({ length: 120 }, (_, i) => 30 + i * 0.32), 4 * H), d1: series(Array.from({ length: 90 }, (_, i) => 20 + i * 0.53), 24 * H, () => 1000, 0.02) },
    chart: { bias: "LONG", regime: "TRENDING", trendFrames: 3, planStatus: "READY", bos: "BULLISH", choch: "BULLISH", sweep: "NONE", btcCorrelation: null, btcBeta: null },
    oi: { series: Array.from({ length: 200 }, (_, i) => ({ t: NOW - (200 - i) * H, coins: 1e6 * (1 + i * 0.001) })) }, venues: { binanceTopPositions: 0.6, okxTopPositions: 0.6 }, liquidations: null, funding: { current: 0.0001, intervalHours: 8, history: Array.from({ length: 60 }, () => 0.0001), at: NOW } });
  assert.equal(r.side, "LONG"); assert.ok(r.scores.bullishBias >= 45, "bias " + r.scores.bullishBias);
  if (r.status === "ENTRY READY") { assert.match(r.sizing, /^Risk 0.5% of equity/); const lv = r.levels.pullback; assert.equal(lv.targets.length, 5); assert.ok(lv.stop < lv.entry); assert.ok(Math.abs(lv.size.qty * (lv.entry - lv.stop + lv.entry * 0.0013) - 50) < 1, "size is the risk divided by loss per unit"); }
  else assert.ok(["AWAITING CONFIRMATION", "AWAITING PULLBACK", "CHASING RISK", "SETUP FORMING"].includes(r.status), r.status);
});

// ── Outcome scoring (shadow-mode log)
const ofile = new URL("../app/lib/ws2/outcomes.ts", import.meta.url).pathname;
const omod = new Module(ofile); omod.require = require;
omod._compile(ts.transpileModule(readFileSync(ofile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ofile);
const { scoreOutcome, summarise } = omod.exports;
const Q = 900_000; const T0 = NOW - 40 * H;
const bar = (i, open, high, low, close) => ({ time: T0 + i * Q, open, high, low, close, volume: 1 });
const shortSignal = (extra = {}) => ({ id: "X:" + T0, at: T0, version: "t", coin: "X", symbol: "XUSDT", status: "AWAITING PULLBACK", side: "SHORT", price: 100, scores: {}, plan: { entryLow: 101, entryHigh: 102, entry: 101.5, stop: 104, targets: [99, 97, 95, 93, 91] }, inputs: [], costPct: 0.13, ...extra });

test("Outcome: an entry that never trades is UNFILLED; a stop touched first cancels with no loss", () => {
  const drift = Array.from({ length: 120 }, (_, i) => bar(i, 100, 100.5, 99.5, 100));
  const u = scoreOutcome(shortSignal(), drift, NOW); assert.equal(u.result, "UNFILLED"); assert.equal(u.netR, 0); assert.equal(u.filled, false);
  const spike = [bar(0, 100, 100.5, 99.8, 100.4), bar(1, 100.4, 100.9, 100.2, 100.8)]; // gap straight through the zone to the stop
  const gap = [...spike, bar(2, 104.5, 105, 104.2, 104.6), ...Array.from({ length: 100 }, (_, i) => bar(3 + i, 104.6, 105, 104.2, 104.6))];
  const c = scoreOutcome(shortSignal(), gap, NOW); assert.equal(c.result, "INVALIDATED BEFORE ENTRY"); assert.equal(c.netR, 0);
  assert.equal(scoreOutcome(shortSignal({ at: NOW - H }), drift, NOW), null, "too early to judge");
});

test("Outcome: fill then targets, fill then stop, same-candle conflict counts as a stop, costs are deducted", () => {
  const fill = bar(1, 100.5, 101.6, 100.4, 101.2);
  const win = [bar(0, 100, 100.5, 99.8, 100.4), fill, bar(2, 101.2, 101.3, 98.8, 99), bar(3, 99, 99.2, 96.8, 97.2), ...Array.from({ length: 110 }, (_, i) => bar(4 + i, 97.2, 97.6, 97.05, 97.3))];
  const w = scoreOutcome(shortSignal(), win, NOW); assert.equal(w.filled, true); assert.equal(w.result, "TP2"); assert.ok(w.netR > 1 && w.netR < (w.fillPrice - 97) / (104 - w.fillPrice), "net of costs");
  const lose = [bar(0, 100, 100.5, 99.8, 100.4), fill, bar(2, 101.2, 104.3, 101, 104.1), ...Array.from({ length: 110 }, (_, i) => bar(3 + i, 104, 104.2, 103.8, 104))];
  const l = scoreOutcome(shortSignal(), lose, NOW); assert.equal(l.result, "STOP"); assert.ok(l.netR < -1);
  const both = [bar(0, 100, 100.5, 99.8, 100.4), fill, bar(2, 101.2, 104.3, 98.5, 99), ...Array.from({ length: 110 }, (_, i) => bar(3 + i, 99, 99.2, 98.8, 99))];
  assert.equal(scoreOutcome(shortSignal(), both, NOW).result, "STOP", "stop and target in one candle: the stop is assumed first");
  const none = scoreOutcome(shortSignal({ plan: null, side: null, status: "NO TRADE" }), win, NOW); assert.equal(none.result, "NO PLAN"); assert.equal(none.directionRight, null);
  const perf = summarise([{ ...shortSignal(), outcome: w }, { ...shortSignal({ id: "b" }), outcome: l }], 7, NOW);
  assert.equal(perf.filled, 2); assert.equal(perf.tp1BeforeStop, 1); assert.equal(perf.stops, 1); assert.equal(perf.sample, "INSUFFICIENT SAMPLE");
});
