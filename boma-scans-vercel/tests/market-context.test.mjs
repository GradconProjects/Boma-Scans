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
const orderBook = load("app/lib/order-book.ts");
const market = load("app/lib/market.ts");
const recommendations = load("app/lib/recommendations.ts");

test("Order-book balance counts only depth within 1% of mid and flags walls", () => {
  const raw = { b: [["100", "10"], ["99.5", "30"], ["90", "1000"]], a: [["100.5", "5"], ["101", "5"], ["120", "1000"]] };
  const book = orderBook.summarizeOrderBook("TESTUSDT", raw, 1000);
  assert.equal(book.mid, 100.25);
  assert.ok(Math.abs(book.bidUsd - (1000 + 2985)) < 1e-6, "the 90 level is outside the band");
  assert.ok(Math.abs(book.askUsd - (502.5 + 505)) < 1e-6);
  assert.equal(book.verdict, "BID HEAVY");
  assert.ok(book.bidPct > 75);
  assert.ok(book.largestBidWallPct > 70);
  assert.match(orderBook.orderBookAdvice(book, "LONG"), /favours your side/);
  assert.match(orderBook.orderBookAdvice(book, "SHORT"), /leans against your side/);
  assert.equal(orderBook.summarizeOrderBook("TESTUSDT", { b: [], a: [] }), null);
});

test("BTC daily trend comes from closed daily candles and halves size against it", () => {
  const up = Array.from({ length: 260 }, (_, i) => ({ time: i * 864e5, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
  const down = up.map((c, i) => ({ ...c, open: 400 - i, high: 401 - i, low: 399 - i, close: 400 - i }));
  assert.equal(market.btcDailyTrend(up), "BULL");
  assert.equal(market.btcDailyTrend(down), "BEAR");
  assert.equal(market.btcDailyTrend(up.slice(0, 30)), "UNKNOWN");
  const candles = market.generateDemoCandles("ETHUSDT", "60", 480);
  const price = candles.at(-1).close;
  const ticker = market.normalizeTicker({ symbol: "ETHUSDT", lastPrice: price, markPrice: price, turnover24h: 500_000_000, openInterestValue: 1e8, volume24h: 1e6, bid1Price: price * .99999, ask1Price: price * 1.00001 });
  const analysis = market.analyzeMarket(candles, candles, candles, ticker, "DAY");
  const withTrend = market.analyzeBtcRelationship("ETHUSDT", candles, candles, analysis, analysis.bias === "LONG" ? up : down);
  const againstTrend = market.analyzeBtcRelationship("ETHUSDT", candles, candles, analysis, analysis.bias === "LONG" ? down : up);
  assert.equal(withTrend.trendAligned, true);
  assert.equal(againstTrend.trendAligned, false);
  assert.equal(market.analyzeBtcRelationship("ETHUSDT", candles, candles, analysis).btcDailyTrend, "UNKNOWN");
  const rowWith = market.scannerRowFromAnalysis(ticker, analysis, false, undefined, "DAY", withTrend);
  const rowAgainst = market.scannerRowFromAnalysis(ticker, analysis, false, undefined, "DAY", againstTrend);
  assert.equal(rowWith.openInterestValue, 1e8);
  assert.equal(rowWith.volume24h, 1e6);
  const plan = row => recommendations.getMediumRiskShortlist([{ ...row, entryReady: true, decision: "SETUP", exchangeMaxLeverage: 50, quantityStep: 0.01, minOrderQty: 0.01, minNotionalValue: 5, turnover: 1e9, regime: "TRENDING", trendFrames: 3, riskBand: "MEDIUM", ratingScore: 90, entryQuality: 90, score: 95, setupThreshold: 70, entryChecks: [], executionCostR: 0, spreadCostLimitR: 0.2, executionPlan: { ...row.executionPlan, status: "READY", timingReady: true, expiresAt: Date.now() + 3600_000, entryLow: 0, entryHigh: 1e12 }, analyzedAt: Date.now() }], 10_000, true, 1)[0];
  const a = plan(rowWith), b = plan(rowAgainst);
  if (a && b) assert.ok(b.riskPct <= a.riskPct / 2 + 1e-9, "against-trend risk is at most half");
});
