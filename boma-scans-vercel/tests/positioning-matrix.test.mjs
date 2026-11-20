import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/positioning-matrix.ts", import.meta.url).pathname;
const mod = new Module(file); mod.require = (id) => id === "@/app/lib/market" ? { formatPrice: (v) => String(v) } : require(id);
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { positioningMatrix, matrixLines } = mod.exports;
const whales = (bookLong, bookShort, flowLong, flowShort) => ({ bookLong, bookShort, positions: 8, flow24: { longUsd: flowLong, shortUsd: flowShort }, flow6: { longUsd: 0, shortUsd: 0 }, top: [{ label: "0xabc", tier: "ELITE", rank: 2, side: "SHORT", sizeUsd: 2e7, entry: 100, pnl: 1e6 }] });
const tops = (b, o) => [{ name: "Binance top traders", kind: "top traders", longShare: b, basis: "positions" }, { name: "OKX top traders", kind: "top traders", longShare: o, basis: "positions" }];

test("Strong hands vs crowd: whales and smart money SHORT, crowd crowded LONG favours SHORT", () => {
  const x = positioningMatrix({ coin: "SOL", whales: whales(1e6, 4e7, 2e5, 3e6), venues: tops(0.38, 0.36), crowd: { longRatio: 0.78, longRatioPrev: 0.7, oiChange24h: 0.06, fundingRate: 0.0002 } }, "SHORT");
  assert.equal(x.pattern, "STRONG HANDS vs CROWD (best setup)");
  assert.equal(x.bestSide, "SHORT"); assert.ok(x.scores.SHORT >= 85); assert.ok(x.scores.LONG <= 15);
  assert.equal(x.forSide.verdict, "FAVOURABLE"); assert.ok(x.checklist.every(c => c.startsWith("✔")));
  const lines = matrixLines(x).join("\n");
  for (const s of ["🐋 WHALES: SHORT", "🏦 SMART MONEY: SHORT", "👥 BYBIT CROWD: LONG · CROWDED", "HOW THEY LINE UP", "POSITIONING ADVICE"]) assert.ok(lines.includes(s), s);
});

test("Whales vs smart money conflict gives no best side and a cautious verdict", () => {
  const x = positioningMatrix({ coin: "ETH", whales: whales(1e6, 3e7, 0, 2e6), venues: tops(0.68, 0.66), crowd: { longRatio: 0.55, longRatioPrev: 0.55, oiChange24h: 0, fundingRate: 0 } }, "SHORT");
  assert.equal(x.pattern, "WHALES vs SMART MONEY (conflict)"); assert.equal(x.forSide.verdict, "MIXED");
});

test("Everyone on one side is flagged as crowded; no data is handled", () => {
  const x = positioningMatrix({ coin: "DOGE", whales: whales(4e7, 1e6, 3e6, 0), venues: tops(0.7, 0.68), crowd: { longRatio: 0.75, longRatioPrev: 0.7, oiChange24h: 0, fundingRate: 0.0005 } }, "LONG");
  assert.equal(x.pattern, "EVERYONE ON ONE SIDE (crowded)"); assert.notEqual(x.forSide.verdict, "UNFAVOURABLE");
  const none = positioningMatrix({ coin: "XYZ", whales: null, venues: [], crowd: null });
  assert.equal(none.pattern, "NO EDGE"); assert.equal(none.bestSide, null);
});
