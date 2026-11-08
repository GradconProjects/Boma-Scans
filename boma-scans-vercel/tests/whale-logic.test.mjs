import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/whale-logic.ts", import.meta.url).pathname;
const mod = new Module(file); mod.require = require;
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { diffPositions, rankWhales, confirmWhaleSignals, bybitSymbolFor } = mod.exports;
const pos = (trader, coin, side, sizeUsd, entry, pnl = 0) => ({ trader, coin, side, sizeUsd, entry, leverage: 5, liquidation: null, pnl, accountValue: 5e6 });
const price = () => 100;

test("Snapshot diff: first snapshot is the baseline; later ones yield OPEN / ADD / REDUCE / CLOSE / FLIP with held time", () => {
  const first = diffPositions(null, [pos("A", "BTC", "LONG", 1e6, 100)], 1000, price);
  assert.deepEqual(first.events, []); assert.equal(first.next.at, 1000);
  const second = diffPositions(first.next, [pos("A", "BTC", "LONG", 1.3e6, 100), pos("B", "ETH", "SHORT", 5e5, 100), pos("M", "APE", "LONG", 20_000, 1)], 2000, price);
  assert.deepEqual(second.events.map(e => [e.trader, e.kind, Math.round(e.deltaUsd)]), [["A", "ADD", 300000], ["B", "OPEN", 500000]], "a $20K open is noise and not recorded");
  const third = diffPositions(second.next, [pos("A", "BTC", "SHORT", 2e5, 101), pos("B", "ETH", "SHORT", 4e5, 100, 2000), pos("M", "APE", "LONG", 20_000, 1)], 3000, price);
  assert.deepEqual(third.events.map(e => [e.trader, e.kind]), [["A", "FLIP"], ["B", "REDUCE"]]);
  assert.equal(third.events[0].heldMs, 2000);
  const fourth = diffPositions(third.next, [pos("A", "BTC", "SHORT", 2e5, 101), pos("M", "APE", "LONG", 20_000, 1)], 4000, price);
  assert.deepEqual(fourth.events.map(e => [e.trader, e.kind, e.pnl]), [["B", "CLOSE", 2000]]);
  assert.equal(fourth.events[0].heldMs, 2000);
});

test("Rankings reward consistency across windows and tracked wins; tiers follow rank", () => {
  const perf = (trader, pnls, roi = 0.1) => ({ trader, accountValue: 1e7, windows: { day: { pnl: pnls[0], roi }, week: { pnl: pnls[1], roi }, month: { pnl: pnls[2], roi }, allTime: { pnl: pnls[3], roi } } });
  const ranks = rankWhales([perf("lucky", [-1e5, -2e5, 5e6, 1e6], 0.9), perf("steady", [1e5, 3e5, 1e6, 5e7], 0.2), perf("loser", [-1e5, -3e5, -1e6, 1e5], -0.3), { ...perf("mm", [1e5, 1e5, 1e5, 1e5], 0.5), openPositions: 28 }], [
    ...Array.from({ length: 6 }, (_, i) => ({ trader: "steady", kind: "CLOSE", pnl: i < 5 ? 1000 : -500 })),
  ]);
  assert.equal(ranks[0].trader, "steady"); assert.equal(ranks[0].tier, "ELITE"); assert.equal(ranks[0].consistency, 4); assert.equal(ranks[0].trackedCloses, 6); assert.ok(Math.abs(ranks[0].trackedWinRate - 5 / 6) < 1e-9);
  assert.equal(ranks.find(r => r.trader === "mm").tier, "WATCH", "market makers never confirm"); assert.ok(ranks.find(r => r.trader === "mm").marketMaker);
  assert.equal(ranks.find(r => r.trader === "loser").tier, "ELITE", "only three directional whales, so all are top ten") ;
});

test("Confirmation: two ranked whales opening the same side near price confirm; a profitable old add counts less; opposition and run-away are flagged", () => {
  const ranks = [{ trader: "A", label: "A", tier: "ELITE" }, { trader: "B", label: "B", tier: "STRONG" }, { trader: "C", label: "C", tier: "STRONG" }, { trader: "W", label: "W", tier: "WATCH" }];
  const now = 100 * 3_600_000;
  const ev = (trader, coin, side, kind, deltaUsd, entry, extra = {}) => ({ id: trader + coin + kind, at: now - 3_600_000, trader, coin, kind, side, sizeUsd: deltaUsd, deltaUsd, entry, price: entry, pnl: 0, heldMs: 0, ...extra });
  const signals = confirmWhaleSignals([
    ev("A", "SOL", "LONG", "OPEN", 2e6, 100), ev("B", "SOL", "LONG", "ADD", 6e5, 100.2),
    ev("A", "DOGE", "SHORT", "OPEN", 3e5, 0.1), ev("W", "DOGE", "SHORT", "OPEN", 3e5, 0.1),
    ev("B", "ETH", "LONG", "ADD", 8e5, 90, { sizeUsd: 5e6, pnl: 6e5, heldMs: 3 * 86_400_000 }), ev("C", "ETH", "LONG", "ADD", 8e5, 90, { sizeUsd: 5e6, pnl: 6e5, heldMs: 3 * 86_400_000 }),
    ev("A", "XRP", "LONG", "OPEN", 2e6, 1), ev("B", "XRP", "LONG", "OPEN", 2e6, 1), ev("C", "XRP", "SHORT", "OPEN", 2e6, 1),
  ], ranks, { SOL: 100.3, DOGE: 0.1, ETH: 100, XRP: 1.05 }, now);
  const sol = signals.find(s => s.coin === "SOL"); assert.ok(sol); assert.equal(sol.status, "NEW ENTRY"); assert.equal(sol.distinct, 2); assert.ok(sol.confidence >= 55);
  assert.ok(!signals.some(s => s.coin === "DOGE"), "one elite with only $300K plus a watch-tier whale is not enough");
  const eth = signals.find(s => s.coin === "ETH"); assert.ok(!eth || eth.status === "RAN AWAY" || eth.score < sol.score, "adds to already profitable old positions are discounted");
  const xrp = signals.find(s => s.coin === "XRP"); assert.ok(xrp); assert.equal(xrp.opposed.length, 1); assert.equal(xrp.status, "RAN AWAY");
  assert.equal(bybitSymbolFor("kPEPE", new Set(["1000PEPEUSDT"])), "1000PEPEUSDT"); assert.equal(bybitSymbolFor("BTC", new Set(["BTCUSDT"])), "BTCUSDT"); assert.equal(bybitSymbolFor("HYPE", new Set(["BTCUSDT"])), null);
});
