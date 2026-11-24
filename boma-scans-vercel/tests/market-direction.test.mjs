import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const load = (rel, map = {}) => { const file = new URL(rel, import.meta.url).pathname; const m = new Module(file); m.require = id => map[id] ?? require(id); m._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return m.exports; };
const engine = load("../app/lib/ws2/engine.ts");
const { marketDirection, marketDirectionLines, correlation } = load("../app/lib/market-direction.ts", { "@/app/lib/ws2/engine": engine });
const H = 3_600_000, NOW = 1_800_000_000_000;
const candles = (closes, step = H) => closes.map((close, i) => ({ time: NOW - (closes.length - i) * step, open: i ? closes[i - 1] : close, high: Math.max(close, i ? closes[i - 1] : close) * 1.001, low: Math.min(close, i ? closes[i - 1] : close) * 0.999, close, volume: 1 }));
const noise = (i, k) => Math.sin(i * 1.7 + k) * 0.002;
const path = (n, drift, k = 0, own = 0) => { let p = 100; return Array.from({ length: n }, (_, i) => (p *= 1 + drift + noise(i, 0) + own * noise(i * 3, k + 5))); };

test("BTC rules: coins fall with a falling Bitcoin, and the advice is to short or stay out", () => {
  const btc = candles(path(80, -0.002)), btc4h = candles(path(120, -0.004), 4 * H);
  const alts = Array.from({ length: 12 }, (_, k) => ({ coin: "A" + k, h1: candles(path(80, -0.003, k, 0.2)) }));
  const m = marketDirection(btc, btc4h, alts, NOW);
  assert.equal(m.overall, "BEARISH"); assert.equal(m.btc.trend, "BEARISH"); assert.equal(m.market.trend, "BEARISH");
  assert.equal(m.ruler, "BTC RULES"); assert.ok(m.correlation >= 0.65); assert.equal(m.strength, "BTC STRONGER");
  assert.match(m.advice, /SHORT setups or stay out/);
  const text = marketDirectionLines(m).join("\n"); for (const s of ["MARKET DIRECTION", "WHO RULES: BTC RULES", "WHAT TO DO"]) assert.ok(text.includes(s), s);
});

test("Alts rule: Bitcoin is quiet while coins run on their own", () => {
  const btc = candles(Array.from({ length: 80 }, (_, i) => 100 * (1 + Math.sin(i) * 0.0004))), btc4h = candles(Array.from({ length: 120 }, (_, i) => 100 * (1 + Math.sin(i) * 0.001)), 4 * H);
  const alts = Array.from({ length: 12 }, (_, k) => ({ coin: "A" + k, h1: candles(Array.from({ length: 80 }, (_, i) => 50 * (1 + i * 0.002 + Math.sin(i * (k + 2)) * 0.004))) }));
  const m = marketDirection(btc, btc4h, alts, NOW);
  assert.equal(m.ruler, "ALTS RULE"); assert.equal(m.strength, "ALTS STRONGER"); assert.equal(m.market.trend, "BULLISH"); assert.match(m.rulerPlain, /moving on their own/);
  assert.equal(m.leaders.length, 3); assert.ok(m.leaders[0].vsBtc >= m.laggards[0].vsBtc);
});

test("Too little data gives no reading; correlation needs enough points", () => {
  assert.equal(marketDirection(candles(path(10, 0)), [], [], NOW), null);
  assert.equal(correlation([1, 2], [1, 2]), null); assert.ok(correlation(Array.from({ length: 20 }, (_, i) => i), Array.from({ length: 20 }, (_, i) => i * 2)) > 0.99);
});
