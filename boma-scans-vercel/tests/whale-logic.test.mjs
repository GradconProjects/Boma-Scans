import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/whale-logic.ts", import.meta.url).pathname;
const mod = new Module(file); mod.require = require;
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { diffPositions, rankWhales, confirmWhaleSignals, confirmWhaleExits, bybitSymbolFor } = mod.exports;
const pos = (trader, coin, side, sizeUsd, entry, pnl = 0) => ({ trader, coin, side, sizeUsd, entry, leverage: 5, liquidation: null, pnl, accountValue: 5e6 });
const price = () => 100;

test("Snapshot diff: first snapshot is the baseline; later ones yield OPEN / ADD / REDUCE / CLOSE / FLIP with held time", () => {
  const first = diffPositions(null, [pos("A", "BTC", "LONG", 1e6, 100), pos("B", "XRP", "LONG", 1e5, 1), pos("M", "DOGE", "LONG", 1e5, 1)], 1000, price);
  assert.deepEqual(first.events, []); assert.equal(first.next.at, 1000);
  const second = diffPositions(first.next, [pos("A", "BTC", "LONG", 1.3e6, 100), pos("B", "XRP", "LONG", 1e5, 1), pos("B", "ETH", "SHORT", 5e5, 100), pos("M", "DOGE", "LONG", 1e5, 1), pos("M", "APE", "LONG", 20_000, 1)], 2000, price);
  assert.deepEqual(second.events.map(e => [e.trader, e.kind, Math.round(e.deltaUsd)]), [["A", "ADD", 300000], ["B", "OPEN", 500000]], "a $20K open is noise and not recorded");
  const third = diffPositions(second.next, [pos("A", "BTC", "SHORT", 2e5, 101), pos("B", "XRP", "LONG", 1e5, 1), pos("B", "ETH", "SHORT", 4e5, 100, 2000), pos("M", "DOGE", "LONG", 1e5, 1), pos("M", "APE", "LONG", 20_000, 1)], 3000, price);
  assert.deepEqual(third.events.map(e => [e.trader, e.kind]), [["A", "FLIP"], ["B", "REDUCE"]]);
  assert.equal(third.events[0].heldMs, 2000);
  const newcomer = diffPositions(third.next, [pos("A", "BTC", "SHORT", 2e5, 101), pos("B", "XRP", "LONG", 1e5, 1), pos("B", "ETH", "SHORT", 4e5, 100, 2000), pos("M", "DOGE", "LONG", 1e5, 1), pos("M", "APE", "LONG", 20_000, 1), pos("Z", "BTC", "LONG", 9e6, 100)], 3500, price);
  assert.deepEqual(newcomer.events, [], "a trader seen for the first time contributes a baseline, not an OPEN");
  const fourth = diffPositions(newcomer.next, [pos("A", "BTC", "SHORT", 2e5, 101), pos("B", "XRP", "LONG", 1e5, 1), pos("Z", "BTC", "LONG", 9e6, 100), pos("M", "DOGE", "LONG", 1e5, 1), pos("M", "APE", "LONG", 20_000, 1)], 4000, price);
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
  assert.equal(signals.find(s => s.coin === "DOGE").status, "WEAK", "one elite with only $300K plus a watch-tier whale is not enough");
  const eth = signals.find(s => s.coin === "ETH"); assert.ok(!eth || eth.status === "RAN AWAY" || eth.score < sol.score, "adds to already profitable old positions are discounted");
  const xrp = signals.find(s => s.coin === "XRP"); assert.ok(xrp); assert.equal(xrp.opposed.length, 1); assert.equal(xrp.status, "RAN AWAY");
  assert.equal(bybitSymbolFor("kPEPE", new Set(["1000PEPEUSDT"])), "1000PEPEUSDT"); assert.equal(bybitSymbolFor("BTC", new Set(["BTCUSDT"])), "BTCUSDT"); assert.equal(bybitSymbolFor("HYPE", new Set(["BTCUSDT"])), null);
});

test("Exit signals: the whales behind an issued entry leaving means LEAVE; one cut means REDUCE", () => {
  const ranks = [{ trader: "A", label: "A", tier: "ELITE", marketMaker: false }, { trader: "B", label: "B", tier: "STRONG", marketMaker: false }, { trader: "M", label: "M", tier: "WATCH", marketMaker: true }];
  const now = 200 * 3_600_000;
  const ev = (trader, coin, side, kind, deltaUsd, pnl) => ({ id: trader + coin + kind, at: now - 3_600_000, trader, coin, kind, side, sizeUsd: 0, deltaUsd, entry: 100, price: 100, pnl, heldMs: 10 * 3_600_000 });
  const issued = [{ coin: "SOL", side: "LONG", at: now - 20 * 3_600_000, traders: ["A", "B"] }];
  const exits = confirmWhaleExits([ev("A", "SOL", "LONG", "CLOSE", -2e6, 150_000), ev("B", "SOL", "LONG", "REDUCE", -4e5, 20_000), ev("M", "SOL", "LONG", "CLOSE", -5e6, 0), ev("B", "ETH", "LONG", "REDUCE", -3e5, -10_000)], ranks, issued, now);
  const sol = exits.find(x => x.coin === "SOL"); assert.ok(sol); assert.equal(sol.urgency, "LEAVE"); assert.ok(sol.whales.some(w => w.wasLeader)); assert.equal(sol.whales.length, 2, "market makers never count"); assert.equal(sol.realizedPnl, 170_000);
  assert.ok(!exits.some(x => x.coin === "ETH"), "a single cut on a coin we never signalled is not an exit signal");
});

test("Early warning on entered trades: ranked whale closing my side is CRITICAL; backing is INFO", () => {
  const { whaleTradeWarnings } = mod.exports;
  const ranks = [{ trader: "A", label: "A", tier: "ELITE", marketMaker: false }, { trader: "B", label: "B", tier: "STRONG", marketMaker: false }, { trader: "M", label: "M", tier: "WATCH", marketMaker: true }];
  const now = 300 * 3_600_000;
  const ev = (trader, coin, side, kind, deltaUsd, pnl = 0) => ({ id: trader + coin + kind, at: now - 60_000, trader, coin, kind, side, sizeUsd: 0, deltaUsd, entry: 100, price: 100, pnl, heldMs: 5 * 3_600_000 });
  const entered = [{ coin: "SOL", side: "LONG", entry: 100, at: now - 3_600_000 }, { coin: "ETH", side: "SHORT", entry: 100, at: now - 3_600_000 }, { coin: "BTC", side: "LONG", entry: 100, at: now - 3_600_000 }];
  const warnings = whaleTradeWarnings(entered, [ev("A", "SOL", "LONG", "CLOSE", -3e6, 250_000), ev("M", "SOL", "LONG", "CLOSE", -9e6), ev("B", "ETH", "LONG", "OPEN", 4e5), ev("B", "BTC", "LONG", "ADD", 8e5)], ranks, now);
  const sol = warnings.find(w => w.coin === "SOL"); assert.equal(sol.severity, "CRITICAL"); assert.equal(sol.against.length, 1, "market makers never count"); assert.match(sol.headline, /ranked whale closed or flipped/);
  const eth = warnings.find(w => w.coin === "ETH"); assert.equal(eth.severity, "WARNING"); assert.equal(eth.against[0].kind, "OPEN");
  const btc = warnings.find(w => w.coin === "BTC"); assert.equal(btc.severity, "INFO"); assert.equal(btc.withUsd, 8e5);
});

test("Whale entries: price against the whales is UNDERWATER, and whales who already left drop out", () => {
  const ranks = [{ trader: "A", label: "A", tier: "ELITE" }, { trader: "B", label: "B", tier: "ELITE" }, { trader: "C", label: "C", tier: "STRONG" }];
  const now = 100 * 3_600_000;
  const ev = (trader, coin, side, kind, deltaUsd, entry, ago = 3_600_000) => ({ id: trader + coin + kind, at: now - ago, trader, coin, kind, side, sizeUsd: deltaUsd, deltaUsd, entry, price: entry, pnl: 0, heldMs: 0 });
  const signals = confirmWhaleSignals([
    // ZEC-like: two elite shorts around 925, price now 955 (3.2% against them).
    ev("A", "ZEC", "SHORT", "ADD", 1.4e6, 942), ev("B", "ZEC", "SHORT", "OPEN", 1.4e6, 913),
    // BTC: C added short, then closed it; only A remains.
    ev("C", "BTC", "SHORT", "ADD", 4e6, 100, 5 * 3_600_000), ev("C", "BTC", "SHORT", "CLOSE", -4e6, 100, 600_000), ev("A", "BTC", "SHORT", "ADD", 5e5, 100),
  ], ranks, { ZEC: 955, BTC: 100 }, now);
  const zec = signals.find(s => s.coin === "ZEC"); assert.equal(zec.status, "UNDERWATER"); assert.match(zec.note, /Not an entry/);
  const btc = signals.find(s => s.coin === "BTC"); assert.ok(btc); assert.deepEqual(btc.whales.map(w => w.trader), ["A"], "a whale who closed is no longer part of the call"); assert.equal(btc.status, "WEAK");
});

test("Plain words: every whale card says what to do first, in everyday language", () => {
  const pw = new URL("../app/lib/plain-words.ts", import.meta.url).pathname;
  const m = new Module(pw); m.require = (id) => id === "@/app/lib/market" ? { formatPrice: (v) => String(Math.round(v * 100) / 100) } : require(id);
  m._compile(ts.transpileModule(readFileSync(pw, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, pw);
  const { whaleSignalPlain, whaleExitPlain, managementPlain, planPlain } = m.exports;
  const s = { coin: "SOL", side: "SHORT", status: "ENTRY AVAILABLE", distinct: 2, flowUsd: 2.4e6, avgEntry: 100, price: 99, opposed: [], whales: [{ tier: "ELITE" }, { tier: "STRONG" }] };
  const go = whaleSignalPlain(s, { bias: "SHORT", trendFrames: 3, agrees: true, opposes: false, stop: 101.5, targets: [96.5, 94, 91.5] });
  assert.match(go.todo[0], /^SELL \(short\) SOL now/); assert.match(go.todo[1], /Stop-loss at 101.5/); assert.match(go.todo[3], /normal size/);
  const held = whaleSignalPlain(s, { bias: "LONG", trendFrames: 2, agrees: false, opposes: true, stop: 101.5, targets: [96.5, 94, 91.5] });
  assert.match(held.todo[0], /^Do nothing/);
  assert.match(whaleSignalPlain({ ...s, status: "UNDERWATER" }, { bias: "SHORT", trendFrames: 1, agrees: false, opposes: false, stop: 1, targets: [] }).todo[0], /do not join/);
  assert.match(whaleExitPlain("SOL", "SHORT", true), /close it now/); assert.match(managementPlain("HOLD"), /^Do nothing/);
  assert.match(planPlain("SOL", { decision: "WAIT", side: "LONG", entry_low: 1, entry_high: 2, stop: 0.5, targets: [3], trigger: "1h close above 2" }), /^Do not enter yet. BUY \(long\) SOL only after/);
});
