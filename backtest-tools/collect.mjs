// Collect candidate setups: everything the engine approves except the target/payoff check.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const [,, rootArg, style, dataFile, outFile, flex = "STRICT", shard = "0", shards = "1"] = process.argv;
const root = path.resolve(rootArg);
const require = createRequire(import.meta.url);
const modules = new Map();
function load(rel) {
  const f = path.resolve(root, rel);
  if (modules.has(f)) return modules.get(f).exports;
  const m = new Module(f); modules.set(f, m);
  m.require = s => s.startsWith("@/") ? load(s.slice(2) + ".ts") : require(s);
  m._compile(ts.transpileModule(readFileSync(f, "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, f);
  return m.exports;
}
const market = load("app/lib/market.ts");
const data = JSON.parse(readFileSync(dataFile, "utf8"));
// Weekly bars (Monday 00:00 UTC, as Bybit) built from daily bars when needed.
for (const v of Object.values(data)) if (!v.W && v["1D"]) { const w = {}; for (const r of v["1D"]) { const day = Math.floor(r[0]/864e5); const b = (day - ((day + 3) % 7)) * 864e5; const a = w[b]; if (!a) w[b] = [b, r[1], r[2], r[3], r[4], r[5]]; else { a[2]=Math.max(a[2],r[2]); a[3]=Math.min(a[3],r[3]); a[4]=r[4]; a[5]+=r[5]; } } v.W = Object.values(w).sort((x,y)=>x[0]-y[0]); }
const toC = r => ({time:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]});
const [f,c,m] = process.env.FRAMES ? process.env.FRAMES.split(",") : {SCALP:["5m","15m","1H"], DAY:["15m","1H","4H"], SWING:["1H","4H","1D"]}[style];
const N = [481,401,361];
function upto(rows, t, n) { let hi = rows.length; let lo = 0; while (lo < hi) { const mid = (lo+hi)>>1; if (rows[mid][0] <= t) lo = mid+1; else hi = mid; } return rows.slice(Math.max(0, lo-n), lo).map(toC); }
const out = []; let evaluated = 0, ready = 0;
for (const sym of Object.keys(data).filter((_, k) => k % Number(shards) === Number(shard))) {
  const F = data[sym][f], C = data[sym][c], M = data[sym][m], B = data.BTC[f];
  for (let i = Number(process.env.START ?? 500); i < F.length - 50; i++) {
    const t = F[i][0]; if (process.env.T_END && t >= Number(process.env.T_END)) break;
    const ctx = upto(C, t, N[1]), mac = upto(M, t, N[2]);
    if (ctx.length < Number(process.env.MIN_CTX ?? 120) || mac.length < Number(process.env.MIN_CTX ?? 120)) continue;
    const fast = F.slice(i-480, i+1).map(toC);
    const live = fast[fast.length-1]; const p = live.open; live.high = live.low = live.close = p; live.volume = 0;
    const ticker = {symbol: sym+"USDT", lastPrice:p, markPrice:p, bid1Price:p*0.99997, ask1Price:p*1.00003, turnover24h:1e9, volume24h:0, fundingRate:0.0001, price24hPcnt:0, highPrice24h:p, lowPrice24h:p, openInterestValue:0};
    const a = market.analyzeMarket(fast, ctx, mac, ticker, style, {flexibility: flex, now: t + 2000});
    evaluated++;
    if (a.entryReady) ready++;
    if (a.decision !== "SETUP") continue;
    const nonTarget = a.entryChecks.filter(ch => ch.required && ch.id !== "targets");
    if (!nonTarget.every(ch => ch.status === "PASS")) continue;
    const btcFast = upto(B, t, 481);
    const btc = market.analyzeBtcRelationship(sym+"USDT", fast, sym === "BTC" ? fast : btcFast, a);
    out.push({sym, i, t, side: a.bias, entry: a.executionPlan.entry, stop: a.stop, atr: a.executionPlan.referenceAtr,
      score: a.score, riskPct: Math.abs(a.executionPlan.entry - a.stop) / a.executionPlan.entry * 100, frames: a.metrics?.trendFrames, conf: a.entryChecks.find(x=>x.id==="candle-conviction")?.status, setupType: a.setupType, regime: a.regime, ready: a.entryReady, btc: btc.divergenceVerdict,
      tps: a.takeProfits.map(x => ({p: x.price, w: x.exitPct, ok: x.available})), targetsPass: a.entryChecks.find(x=>x.id==="targets").status === "PASS",
      path: a.executionPlan.confirmationPath});
  }
}
writeFileSync(outFile, JSON.stringify({style, bar: f, evaluated, ready, candidates: out}));
console.log(style, flex, "evaluated", evaluated, "engine-ready", ready, "candidates", out.length);
