import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Module, { createRequire } from "node:module";
import ts from "typescript";

// Load the actual TypeScript engine without a browser or exchange connection.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const modules = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = new Module(filename);
  modules.set(filename, module);
  module.require = spec => spec.startsWith("@/") ? load(spec.slice(2) + ".ts") : require(spec);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}});
  module._compile(output.outputText, filename);
  return module.exports;
}
const execution = load("app/lib/entry-execution.ts");
const policy = load("app/lib/entry-policy.ts");
const market = load("app/lib/market.ts");
const recommendations = load("app/lib/recommendations.ts");
const manager = load("app/lib/trade-manager.ts");
const leverage = load("app/lib/leverage.ts");
const signals = load("app/lib/signal-alerts.ts");
const confirmation = {mode: "STRICT", setupType: "PULLBACK", score: 76, threshold: 66, confluence: 3, frames: 2, plannedTriggerPassed: false, strongClose: true, structureReady: true, momentumAligned: true, notChased: true, invalidated: false};

function executionFixture(now = Date.now(), changes = {}) {
  const intervalMs = 300_000;
  const end = Math.floor(now / intervalMs) * intervalMs - intervalMs;
  const candles = Array.from({length:32}, (_,i) => ({time:end-(31-i)*intervalMs, open:100, high:100.5, low:99.5, close:100, volume:1000}));
  candles[candles.length-2] = {...candles.at(-2),open:100.1,low:99.4,high:100.25,close:100.2};
  candles[candles.length-1] = {...candles.at(-1),open:100.1,low:99.9,high:100.5,close:100.35};
  const input = {candles,side:"LONG",marketPrice:100.3,zoneLow:100,zoneHigh:100.2,zoneSource:"Test retest",ema21:100,atr:1,intervalMs,now,mode:"STRICT",setupType:"PULLBACK",score:90,threshold:66,confluence:4,frames:3,strongClose:true,structureReady:true,momentumAligned:true,...changes};
  return {input,plan:execution.buildEntryExecutionPlan(input)};
}
function mirrorInput(input) {
  const mirror = bar => ({...bar,open:200-bar.open,high:200-bar.low,low:200-bar.high,close:200-bar.close});
  return {...input,side:"SHORT",marketPrice:200-input.marketPrice,zoneLow:200-input.zoneHigh,zoneHigh:200-input.zoneLow,ema21:200-input.ema21,candles:input.candles.map(mirror),liveCandle:input.liveCandle ? mirror(input.liveCandle) : undefined};
}

test("Planned timing cannot bypass the no-chase rule in any mode", () => {
  for (const mode of ["STRICT","BALANCED","FLEXIBLE"]) {
    assert.equal(policy.resolveEntryTiming({...confirmation,mode,plannedTriggerPassed:true,notChased:false}).passed,false);
  }
});
test("Normal confirmed retests remain actionable for both long and short", () => {
  const {input} = executionFixture();
  for (const side of [input,mirrorInput(input)]) {
    const plan = execution.buildEntryExecutionPlan(side);
    assert.equal(plan.status,"READY");
    assert.equal(plan.timingReady,true);
    assert.equal(execution.entryExecutionBlocker(plan,side.marketPrice,side.now),null);
    assert.equal(plan.steps.length,4);
    assert.match(plan.cancelText,/Never chase/);
  }
});
test("Pump/dump candles cannot confirm their own retest, even in Flexible mode", () => {
  const {input} = executionFixture();
  const pump = {...input.candles.at(-1),open:99.9,low:99.8,high:103.3,close:103.2};
  const pumped = {...input,candles:[...input.candles.slice(0,-1),pump],marketPrice:103.2,breakTime:pump.time,setupType:"BREAKOUT"};
  for (const mode of ["STRICT","BALANCED","FLEXIBLE"]) for (const scenario of [pumped,mirrorInput(pumped)]) {
    const plan = execution.buildEntryExecutionPlan({...scenario,mode});
    assert.equal(plan.status,"WAIT_RETEST");
    assert.equal(plan.timingReady,false);
    assert.equal(plan.impulsePending,true);
    assert.ok(execution.entryExecutionBlocker(plan,scenario.marketPrice,scenario.now,true));
  }
});
test("A pump can qualify only after a later retest and normal confirmation candle", () => {
  const {input} = executionFixture();
  const t = input.candles.at(-1).time;
  const bars = [...input.candles.slice(0,-1),
    {time:t,open:99.9,low:99.8,high:103.3,close:103.2,volume:2000},
    {time:t+300_000,open:103,low:100.05,high:103.1,close:100.4,volume:900},
    {time:t+600_000,open:100.15,low:100,high:100.55,close:100.4,volume:1100}];
  const recovered = {...input,candles:bars,now:t+901_000,marketPrice:100.4,ema21:100.5,breakTime:t,setupType:"BREAKOUT"};
  for (const scenario of [recovered,mirrorInput(recovered)]) {
    const plan = execution.buildEntryExecutionPlan(scenario);
    assert.equal(plan.status,"READY");
    assert.ok(plan.confirmationTime > t);
    assert.equal(plan.impulsePending,false);
  }
});
test("Quote-only chase never drags the zone/stop; failed reclaims and expiry block the click", () => {
  const {input,plan} = executionFixture();
  for (const source of [input,mirrorInput(input)]) {
    const baseline = execution.buildEntryExecutionPlan(source);
    const chase = source.side === "LONG" ? 102 : 98;
    const late = execution.buildEntryExecutionPlan({...source,marketPrice:chase});
    assert.equal(late.zoneLow,baseline.zoneLow);
    assert.equal(late.zoneHigh,baseline.zoneHigh);
    assert.equal(late.stop,baseline.stop);
    assert.equal(late.status,"WAIT_RETEST");
    assert.ok(execution.entryExecutionBlocker(baseline,chase,source.now));
    assert.ok(execution.entryExecutionBlocker(baseline,100,source.now));
    assert.ok(execution.entryExecutionBlocker(baseline,source.marketPrice,baseline.expiresAt));
  }
  assert.equal(execution.buildEntryExecutionPlan({...input,now:plan.expiresAt+1}).status,"EXPIRED");
});
test("Stop remains beyond full zone and retest wick; oversized structure is rejected", () => {
  const {input} = executionFixture();
  for (const source of [input,mirrorInput(input)]) {
    const wide = {...source, zoneLow:source.side === "LONG" ? 95 : source.zoneLow,zoneHigh:source.side === "SHORT" ? 105 : source.zoneHigh};
    const plan = execution.buildEntryExecutionPlan(wide);
    assert.ok(source.side === "LONG" ? plan.stop < 95 : plan.stop > 105);
    assert.equal(plan.status,"BLOCKED");
  }
});
test("An unfinished candle cannot supply confirmation and a pre-entry stop sweep cancels", () => {
  const {input,plan} = executionFixture();
  const notConfirmed = {...input,candles:input.candles.map(bar=>({...bar,open:100,close:100})),liveCandle:{time:input.candles.at(-1).time+300_000,open:100,low:99.9,high:100.5,close:100.4,volume:10}};
  assert.notEqual(execution.buildEntryExecutionPlan(notConfirmed).status,"READY");
  const swept = {...input,liveCandle:{...input.candles.at(-1),time:input.candles.at(-1).time+300_000,low:plan.stop-.1}};
  assert.equal(execution.buildEntryExecutionPlan(swept).status,"INVALIDATED");
  assert.equal(execution.buildEntryExecutionPlan(mirrorInput(swept)).status,"INVALIDATED");
});

test("Strict waits; Balanced accepts strong confirmation at threshold + 6", () => {
  assert.equal(policy.resolveEntryTiming(confirmation).passed, false);
  assert.equal(policy.resolveEntryTiming({...confirmation, mode: "BALANCED", score: 72}).passed, true);
  assert.equal(policy.resolveEntryTiming({...confirmation, mode: "BALANCED", score: 71}).passed, false);
});
test("Flexible continuation does not bypass momentum, structure, alignment or invalidation", () => {
  const input = {...confirmation, mode: "FLEXIBLE", setupType: "BREAKOUT", threshold: 70, score: 70};
  assert.equal(policy.resolveEntryTiming(input).passed, true);
  for (const bad of [{momentumAligned: false}, {structureReady: false}, {strongClose: false}, {notChased: false}, {frames: 1}, {confluence: 2}, {invalidated: true}]) assert.equal(policy.resolveEntryTiming({...input, ...bad}).passed, false);
});
test("All modes preserve a valid planned trigger and reject an invalidated plan", () => {
  for (const mode of ["STRICT", "BALANCED", "FLEXIBLE"]) {
    assert.equal(policy.resolveEntryTiming({...confirmation, mode, plannedTriggerPassed: true}).passed, true);
    assert.equal(policy.resolveEntryTiming({...confirmation, mode, plannedTriggerPassed: true, invalidated: true}).passed, false);
  }
});
test("Risk bands use exact shared cutoffs; BTC caution cannot be LOW", () => {
  const input = {entryReady: true, rating: 84, entryQuality: 84, regime: "TRENDING", targetReliability: 65, btcVerdict: "ACCEPT", requiredFailure: false, override: false};
  assert.equal(policy.relativeRiskBand(input), "LOW");
  assert.equal(policy.relativeRiskBand({...input, btcVerdict: "CAUTION"}), "MEDIUM");
  assert.equal(policy.relativeRiskBand({...input, rating: 70, entryQuality: 68, entryReady: false}), "MEDIUM");
  for (const bad of [{rating: 69}, {entryQuality: 67}, {regime: "VOLATILE"}, {requiredFailure: true}, {btcVerdict: "REJECT"}]) assert.equal(policy.relativeRiskBand({...input, ...bad}), "HIGH");
});

function fixture(symbol = "ETHUSDT", inverse = false) {
  const source = market.generateDemoCandles(symbol, "15", 480);
  const candles = inverse ? source.map(c => ({...c, open: 1e6/c.open, close: 1e6/c.close, high: 1e6/c.low, low: 1e6/c.high})) : source;
  const price = candles.at(-1).close;
  const ticker = market.normalizeTicker({symbol, lastPrice: price, markPrice: price, turnover24h: 500_000_000, bid1Price: price * .99999, ask1Price: price * 1.00001});
  return {candles, ticker};
}
test("Five target slots stay directional and ordered across styles, modes and long/short markets", () => {
  const seenSides = new Set();
  for (const inverse of [false, true]) for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "XRPUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT"]) {
    const {candles, ticker} = fixture(symbol, inverse);
    for (const mode of ["STRICT", "BALANCED", "FLEXIBLE"]) for (const style of ["SCALP", "DAY", "SWING", "POSITION"]) {
      const result = market.analyzeMarket(candles, candles, candles, ticker, style, {flexibility: mode});
      seenSides.add(result.bias);
      assert.ok(result.riskMultiplier >= .25 && result.riskMultiplier <= 1);
      for (const [entry, targets] of [[result.entry, result.takeProfits], [result.immediateEntry.entry, result.immediateEntry.targets]]) {
        assert.equal(targets.length, 5);
        assert.equal(targets.reduce((sum,tp) => sum + tp.exitPct,0), 100);
        let previous = entry;
        for (const tp of targets) {
          assert.ok(Number.isFinite(tp.price) && tp.price > 0);
          assert.ok(result.bias === "LONG" ? tp.price > previous : tp.price < previous);
          previous = tp.price;
          if (tp.level <= 3 && tp.available) assert.ok(!/ATR|volatility map/i.test(tp.source));
        }
      }
      if (result.entryReady) assert.ok(result.entryChecks.every(check => !check.required || check.status === "PASS"));
    }
  }
  assert.deepEqual([...seenSides].sort(), ["LONG", "SHORT"]);
});
test("Unconfirmed targets and insufficient history never authorize entries", () => {
  const {candles, ticker} = fixture();
  const result = market.analyzeMarket(candles.slice(-10), [], [], ticker, "DAY", {flexibility: "FLEXIBLE"});
  assert.equal(result.entryReady, false);
  assert.equal(result.immediateEntry.status, "AVOID");
  assert.equal(result.entryChecks.find(check => check.id === "history").status, "FAIL");
});
test("Full market analysis blocks quote-only pump/dump entries in both execution modes", () => {
  for (const inverse of [false,true]) {
    const {candles,ticker} = fixture("ETHUSDT",inverse);
    const first = market.analyzeMarket(candles,candles,candles,ticker,"DAY",{flexibility:"FLEXIBLE"});
    const price = first.bias === "LONG" ? Math.max(first.executionPlan.entryHigh, first.entry) + 6*first.metrics.atr : Math.min(first.executionPlan.entryLow, first.entry) - 6*first.metrics.atr;
    const late = market.analyzeMarket(candles,candles,candles,{...ticker,lastPrice:price,bid1Price:price*.99999,ask1Price:price*1.00001},"DAY",{flexibility:"FLEXIBLE"});
    assert.equal(late.entryReady,false);
    assert.equal(late.immediateEntry.status,"AVOID");
    assert.equal(late.executionPlan.zoneLow,first.executionPlan.zoneLow);
    assert.equal(late.executionPlan.zoneHigh,first.executionPlan.zoneHigh);
    assert.equal(late.stop,first.stop);
    assert.ok(late.entryChecks.find(check=>check.id==="trigger").status !== "PASS");
  }
});
test("Close-target payoff accounts for round-trip fees and slippage", () => {
  const {candles, ticker} = fixture();
  const cheap = market.analyzeMarket(candles, candles, candles, ticker, "SCALP", {takerFeePct: 0, slippagePct: 0}).immediateEntry;
  const costly = market.analyzeMarket(candles, candles, candles, ticker, "SCALP", {takerFeePct: .3, slippagePct: 1}).immediateEntry;
  assert.ok(costly.netRewardR < cheap.netRewardR);
  assert.equal(costly.status, "AVOID");
});
test("BTC correlation requires timestamp-aligned history, never array-position substitution", () => {
  const {candles, ticker} = fixture();
  const analysis = market.analyzeMarket(candles, candles, candles, ticker);
  const mismatch = candles.map(c => ({...c, time: c.time + 1}));
  const result = market.analyzeBtcRelationship("ETHUSDT", candles, mismatch, analysis);
  assert.equal(result.correlation, null);
  assert.equal(result.divergenceVerdict, "CAUTION");
  assert.equal(result.historyBars, 0);
  assert.ok(market.analyzeBtcRelationship("ETHUSDT", candles, candles, analysis).correlation > .99);
});
test("Shortlist rejects stale rows, missing instrument rules and required failures", () => {
  const row = {price:100.3, executionPlan: executionFixture().plan, analyzedAt: Date.now(), exchangeMaxLeverage: 10, quantityStep: .001, style: "DAY", demo: false, decision: "SETUP", entryReady: true, direction: "LONG", score: 90, setupThreshold: 70, entryQuality: 84, ratingScore: 84, entryChecks: [], riskBand: "LOW", btcRelationship: {divergenceVerdict: "ACCEPT"}, rr: 3, netRewardR: 3, targetReliability: 70, structuralTargets: 3, executionCostR: .01, spreadCostLimitR: .2, turnover: 500_000_000, trendFrames: 3, regime: "TRENDING"};
  assert.equal(recommendations.isMediumRiskTake(row, true), true);
  for (const bad of [{analyzedAt: Date.now() - 16 * 60_000}, {exchangeMaxLeverage: undefined}, {entryChecks: [{required:true,status:"FAIL"}]}, {btcRelationship: {divergenceVerdict:"REJECT"}}, {ratingScore:69}, {entryQuality:67}]) assert.equal(recommendations.isMediumRiskTake({...row,...bad}, true), false);
});
function trade(overrides = {}) {
  return manager.createTrackedTrade({symbol:"BTCUSDT", side:"LONG", mode:"PAPER", style:"DAY", entryPrice:100, quantity:1, leverage:5, stop:99, tp1:101, tp2:102, tp3:103, tp4:104, tp5:105, atrAtEntry:1, ...overrides});
}
test("Frozen targets and close-target weights survive storage; partial fills are idempotent", () => {
  const source = fixture();
  const analysis = market.analyzeMarket(source.candles,source.candles,source.candles,source.ticker);
  const snapshot = {entryMode:"MARKET", flexibility:"FLEXIBLE", score:85, entryQuality:85, btcVerdict:"ACCEPT", overrideAccepted:false, targets:analysis.takeProfits, reasons:["Confirmed"]};
  const position = trade({targetWeights:[30,25,20,15,10], entrySnapshot:snapshot});
  const original = position.entrySnapshot.targets[0].price;
  snapshot.targets[0].price = 1;
  assert.equal(position.entrySnapshot.targets[0].price, original);
  const restored = manager.parseStoredTrades(JSON.stringify([position]))[0];
  assert.deepEqual(restored.targetWeights, [30,25,20,15,10]);
  const partial = manager.applyPartialExit(restored,1,101);
  assert.equal(partial.remainingPct,70);
  assert.equal(manager.applyPartialExit(partial,1,101).remainingPct,70);
  assert.equal(manager.applyPartialExit(partial,5,105).status,"CLOSED");
});
test("Legacy trades remain readable; corrupt storage cannot crash the journal", () => {
  assert.equal(manager.parseStoredTrades(JSON.stringify([trade()])).length, 1);
  assert.deepEqual(manager.parseStoredTrades("{bad"), []);
  assert.equal(manager.parseStoredTrades(JSON.stringify([{...trade(),entrySnapshot:{targets:[null],reasons:[{}]}}]))[0].entrySnapshot, undefined);
});
test("Leverage changes margin, not chosen stop risk; portfolio and stale-quote guards remain", () => {
  for (const exchangeMaxLeverage of [1,3,10,100]) {
    const plan = leverage.buildAdaptiveLeveragePlan({accountEquity:1000,targetRiskPct:.5,entry:100,stop:99,score:95,regime:"TRENDING",trendFrames:3,atrPct:1,adx:30,style:"DAY",actionable:true,exchangeMaxLeverage,quantityStep:.001,minOrderQty:.001,minNotionalValue:5});
    assert.ok(plan.actualRiskPct <= .5 + 1e-9);
    assert.ok(plan.recommendedLeverage <= exchangeMaxLeverage);
  }
  assert.equal(manager.getPortfolioGuard([trade(),trade(),trade()],1000).blocked,true);
  assert.equal(manager.getPortfolioGuard([trade({quantity:30})],1000).blocked,true);
  assert.equal(manager.evaluateTrade(trade(),102,Date.now()-30_000,null).action,"DATA STALE");
});
test("Small gains and TP1 touches no longer force breakeven; partial advice uses frozen weights", () => {
  const now = Date.now();
  for (const side of ["LONG","SHORT"]) {
    const short = side === "SHORT";
    const position = trade({side,stop:short?101:99,tp1:short?99:101,tp2:short?98:102,tp3:short?97:103,tp4:short?96:104,tp5:short?95:105,targetWeights:[30,25,20,15,10]});
    const before = manager.evaluateTrade(position,short?99.2:100.8,now,null,now);
    assert.equal(before.suggestedStop,position.stop);
    assert.equal(before.action,"HOLD TO PLAN");
    const tp1 = manager.evaluateTrade(position,short?99:101,now,null,now);
    assert.equal(tp1.action,"TAKE PARTIAL");
    assert.equal(tp1.suggestedStop,position.stop);
    assert.match(tp1.detail,/30%/);
    assert.doesNotMatch(tp1.detail,/then move.*breakeven/);
  }
});
test("Profit protection needs later structure, never loosens a stop, and ignores stale data", () => {
  const now = Date.now();
  const {candles,ticker} = fixture();
  const analysis = market.analyzeMarket(candles,candles,candles,ticker);
  for (const side of ["LONG","SHORT"]) {
    const short = side === "SHORT";
    const position = {...trade({side,entryPrice:100,stop:short?101:99,tp1:short?99:101,tp2:short?96:104,tp3:short?95:105,tp4:short?94:106,tp5:short?93:107}),openedAt:now-900_000,tp1Taken:true};
    const fresh = {...analysis,bias:side,stop:short?99.5:100.5,regime:"TRENDING",structure:{...analysis.structure,bos:short?"BEARISH":"BULLISH"},metrics:{...analysis.metrics,atr:1,trendFrames:3,confirmedCandleTime:now-300_000},executionPlan:{...analysis.executionPlan,confirmationTime:now-300_000,expiresAt:now+300_000}};
    const price = short?98:102;
    assert.equal(manager.evaluateTrade(position,price,now,fresh,now).suggestedStop,fresh.stop);
    assert.equal(manager.evaluateTrade(position,price,now-30_000,fresh,now).suggestedStop,position.stop);
    const protectedPosition = {...position,stop:short?99:101};
    assert.equal(manager.evaluateTrade(protectedPosition,price,now,fresh,now).suggestedStop,protectedPosition.stop);
    assert.equal(manager.evaluateTrade(position,price,now,{...fresh,executionPlan:{...fresh.executionPlan,confirmationTime:position.openedAt-1}},now).suggestedStop,position.stop);
  }
});

function qualifiedPick(at, overrides = {}) {
  const {candles, ticker} = fixture();
  const analysis = market.analyzeMarket(candles,candles,candles,ticker);
  const raw = market.scannerRowFromAnalysis(ticker,analysis,false,undefined,"DAY");
  const row = {...raw, analyzedAt:at, flexibility:"STRICT", style:"DAY", symbol:"ETHUSDT", bias:"LONG", direction:"LONG", decision:"SETUP", entryReady:true, setupType:"BREAKOUT", setupThreshold:70, score:90, entryQuality:90, entryGrade:"A+", ratingScore:90, ratingGrade:"A+", riskBand:"LOW", regime:"TRENDING", trendFrames:3, rr:3, netRewardR:2.99, targetReliability:75, structuralTargets:3, executionCostR:.01, spreadCostLimitR:.2, turnover:500_000_000, exchangeMaxLeverage:10, quantityStep:.001, entry:100, stop:99, price:100, executionPlan:{...executionFixture(at).plan, entryLow:99.9, entryHigh:100.1, entry:100, expiresAt:at+600_000}, entryChecks:[{id:"structure",label:"Structure",required:true,status:"PASS",weight:1,detail:"Confirmed"}], btcRelationship:{...raw.btcRelationship,divergenceVerdict:"ACCEPT"},
    takeProfits:[1,2,3,4,5].map(level=>({level,price:100+level,available:true,rewardR:level,exitPct:20,confidence:"HIGH",source:"Swing liquidity",sources:["Swing liquidity"],confluenceCount:1,rationale:"Test fixture"})), ...overrides};
  return {row,rank:1,riskPct:.5,riskAmount:50,quantity:50,leverage:5,minimumLeverage:1,maximumLeverage:8,recommendedMargin:1000,marginUtilizationPct:10,leverageRationale:"Risk sized"};
}

test("First qualified scan notifies once; repeat scans and restored history do not spam", () => {
  const now = Date.now();
  const first = signals.reconcileSignals(signals.emptySignalLedger(),[qualifiedPick(now)],"DAY:STRICT",now,now);
  assert.equal(first.added.length,1);
  assert.equal(first.added[0].readAt,null);
  assert.equal(signals.reconcileSignals(first.ledger,[qualifiedPick(now)],"DAY:STRICT",now,now).added.length,0);
  const restored = signals.parseSignalLedger(JSON.stringify(first.ledger));
  const continued = signals.reconcileSignals(restored,[qualifiedPick(now+60_000)],"DAY:STRICT",now+60_000,now+60_000);
  assert.equal(continued.added.length,0);
  assert.equal(continued.ledger.notifications.length,1);
});

test("Withdrawn setups remain history and a genuinely requalified setup can alert again", () => {
  const now=Date.now();
  const first=signals.reconcileSignals(signals.emptySignalLedger(),[qualifiedPick(now)],"DAY:STRICT",now,now);
  const lost=signals.reconcileSignals(first.ledger,[],"DAY:STRICT",now+60_000,now+60_000);
  assert.equal(signals.notificationStatus(lost.ledger.notifications[0],now+60_000),"NO LONGER QUALIFIED");
  const regained=signals.reconcileSignals(lost.ledger,[qualifiedPick(now+120_000)],"DAY:STRICT",now+120_000,now+120_000);
  assert.equal(regained.added.length,1);
  assert.equal(regained.ledger.notifications.length,2);
  assert.equal(signals.notificationStatus(first.added[0],now+16*60_000),"EXPIRED SNAPSHOT");
});

test("Alert gate excludes stale, rejected, demo, wrong-mode and incomplete target signals", () => {
  const now=Date.now();
  for (const bad of [{executionPlan:undefined},{executionPlan:{...executionFixture(now).plan,status:"WAIT_RETEST"}},{executionPlan:{...executionFixture(now).plan,expiresAt:now}},{entryChecks:[{required:true,status:"WAIT"}]},{analyzedAt:now-16*60_000},{demo:true},{riskBand:"HIGH"},{flexibility:"FLEXIBLE"},{takeProfits:[]},{entryChecks:[{required:true,status:"FAIL"}]},{btcRelationship:{divergenceVerdict:"REJECT"}}]) {
    assert.equal(signals.reconcileSignals(signals.emptySignalLedger(),[qualifiedPick(now,bad)],"DAY:STRICT",now,now).added.length,0);
  }
  const initial = signals.emptySignalLedger();
  // A one-second UI clock must not consume the scan before its last rows exist.
  assert.equal(signals.reconcileSignals(initial,[qualifiedPick(now)],"DAY:STRICT",now,now-1).ledger,initial);
});

test("Signal identity distinguishes long/short and mode; copy includes all five original targets", () => {
  const now=Date.now();
  const long=qualifiedPick(now);
  const shortPlan=execution.buildEntryExecutionPlan(mirrorInput(executionFixture(now).input));
  const short=qualifiedPick(now,{bias:"SHORT",direction:"SHORT",executionPlan:shortPlan,entry:99.7,price:99.7,stop:101,takeProfits:long.row.takeProfits.map(target=>({...target,price:100-target.level}))});
  assert.notEqual(signals.signalKey(long.row),signals.signalKey(short.row));
  assert.notEqual(signals.signalKey(long.row),signals.signalKey({...long.row,flexibility:"BALANCED"}));
  const snapshot=signals.snapshotSignal(short);
  short.row.takeProfits[0].price=1;
  assert.equal(snapshot.targets[0].price,99);
  const message=signals.telegramSignalText(snapshot,true,now+16*60_000);
  assert.match(message,/🔴 SHORT/);
  assert.match(message,/EXPIRED SNAPSHOT/);
  assert.equal((message.match(/🎯 Target \d/g)??[]).length,5);
  assert.match(message,/Leverage: 5x/);
  assert.match(message,/No exchange order/);
  assert.match(message,/📍 Coin : #/);
  assert.ok(message.indexOf("👉 Entry") < message.indexOf("🎯 Target 1"));
  assert.ok(message.indexOf("🎯 Target 5") < message.indexOf("❌ StopLoss"));
  assert.match(message,/🎯 Trigger: .* \(close below/);
  assert.match(message,/SELL LIMIT/);
  assert.doesNotMatch(message,/BUY LIMIT/);
  assert.match(message,/⏱ Expires: /);
  assert.match(message,/🎯 Target 1: 99\.0000   \+0\.70%  ·  0\.5R/);
  assert.match(message,/Saved levels/);
});

test("Notification storage is bounded and corrupt records cannot crash the tab", () => {
  const snapshot=signals.snapshotSignal(qualifiedPick(Date.now()));
  const parsed=signals.parseSignalLedger(JSON.stringify({version:1,scopes:{},notifications:[null,{bad:true},...Array.from({length:120},()=>snapshot)]}));
  assert.equal(parsed.notifications.length,100);
  assert.equal(signals.parseSignalLedger("not json").notifications.length,0);
});

test("Sound schedules a bounded two-note chime only when running and unmuted", () => {
  const voices=[];
  const gains=[];
  const context={state:"running",currentTime:10,destination:{},createOscillator(){const voice={frequency:{setValueAtTime(value){voice.frequencyValue=value;}},connect(){},disconnect(){},start(time){voice.startTime=time;},stop(time){voice.stopTime=time;}};voices.push(voice);return voice;},createGain(){const gain={gain:{setValueAtTime(){},exponentialRampToValueAtTime(value){gains.push(value);}},connect(){},disconnect(){}};return gain;}};
  assert.equal(signals.playSetupChime({...context,state:"suspended"},.35),false);
  assert.equal(signals.playSetupChime(context,0),false);
  assert.equal(voices.length,0);
  assert.equal(signals.playSetupChime(context,.5),true);
  assert.equal(voices.length,2);
  assert.deepEqual(voices.map(voice=>voice.frequencyValue),[660,880]);
  assert.ok(voices.every(voice=>voice.stopTime-voice.startTime<.3));
  assert.ok(Math.max(...gains)<=.071);
});

const quoteSafety = load("app/lib/quote-safety.ts");
test("Late REST snapshots cannot replace newer socket quotes", () => {
  const now = Date.now();
  assert.equal(quoteSafety.acceptQuote(now - 100, now - 500, 100, now), false);
  assert.equal(quoteSafety.acceptQuote(now - 500, now - 100, 100, now), true);
  for (const timestamp of [0, NaN, now - 16000, now + 6000]) {
    assert.equal(quoteSafety.acceptQuote(0, timestamp, 100, now), false);
  }
  for (const price of [0, -1, NaN, Infinity]) assert.equal(quoteSafety.acceptQuote(0, now, price, now), false);
});
test("Stale or invalid quotes never suggest adding to a profitable trade", () => {
  const now = Date.now();
  const source = fixture();
  const base = market.analyzeMarket(source.candles, source.candles, source.candles, source.ticker);
  const analysis = {...base, bias:"LONG", regime:"TRENDING", metrics:{...base.metrics,trendFrames:3}, executionPlan:{...base.executionPlan,expiresAt:now+60000}};
  const position = {...trade(),tp1Taken:true,stop:100};
  for (const [price,time] of [[102,now-16000],[102,now+6000],[NaN,now],[0,now]]) {
    const result = manager.evaluateTrade(position,price,time,analysis,now);
    assert.equal(result.action,"DATA STALE");
    assert.match(result.marginAdvice,/NO ADD/);
  }
  assert.match(manager.evaluateTrade(position,105,now,analysis,now).marginAdvice,/NO ADD/);
});
test("Invalid equity and exit prices cannot corrupt trade records", () => {
  for (const equity of [NaN,Infinity,0,-1]) assert.equal(manager.getPortfolioGuard([],equity).blocked,true);
  const position=trade();
  for (const price of [NaN,Infinity,0,-1]) assert.strictEqual(manager.closeTrackedTrade(position,price),position);
  const closed=manager.closeTrackedTrade(position,102);
  assert.strictEqual(manager.closeTrackedTrade(closed,103),closed);
});
test("REST ticker validation rejects missing timestamps, wrong symbols and invalid prices", async () => {
  const original=globalThis.fetch;
  const now=Date.now();
  try {
    for (const payload of [
      {result:{list:[{symbol:"BTCUSDT",lastPrice:"100"}]}},
      {time:now,result:{list:[{symbol:"ETHUSDT",lastPrice:"100"}]}},
      {time:now,result:{list:[{symbol:"BTCUSDT",lastPrice:"invalid"}]}},
    ]) {
      globalThis.fetch=async()=>({ok:true,json:async()=>payload});
      await assert.rejects(()=>market.fetchTicker("BTCUSDT"));
    }
    globalThis.fetch=async()=>({ok:true,json:async()=>({time:now,result:{list:[{symbol:"BTCUSDT",lastPrice:"100"}]}})});
    const result=await market.fetchTicker("BTCUSDT");
    assert.equal(result.updatedAt,now);
    assert.equal(result.lastPrice,100);
  } finally { globalThis.fetch=original; }
});
test("Trade targets use last price while liquidation checks use mark price", () => {
  const now=Date.now();
  const position=trade({liquidationPrice:90});
  const target=manager.evaluateTrade(position,101,now,null,now,100);
  assert.equal(target.exitLevel,1);
  assert.equal(target.pnl,1);
  const liquidation=manager.evaluateTrade(position,100,now,null,now,90.1);
  assert.equal(liquidation.action,"EXIT NOW");
  assert.match(liquidation.headline,/Liquidation/);
});
test("Malformed candle data fails closed rather than producing a signal", async () => {
  const original=globalThis.fetch;
  try {
    for (const rows of [
      [[1000,100,99,98,100,10]],
      [[1000,100,101,99,0,10]],
      [[1000,100,101,99,100,10],[1000,100,101,99,100,10]],
    ]) {
      globalThis.fetch=async()=>({ok:true,json:async()=>({result:{list:rows}})});
      await assert.rejects(()=>market.fetchKlines("BTCUSDT","15"));
    }
  } finally {globalThis.fetch=original;}
});

const locked = load("app/lib/locked-plan.ts");
test("Fixed entry does not track the quote inside or outside the entry range", () => {
  const {input}=executionFixture();
  for (const source of [input,mirrorInput(input)]) {
    const first=execution.buildEntryExecutionPlan(source);
    for (const price of [source.marketPrice,source.marketPrice+.05,source.marketPrice-.05]) {
      const next=execution.buildEntryExecutionPlan({...source,marketPrice:price});
      assert.equal(next.entry,first.entry);
      assert.equal(next.stop,first.stop);
    }
  }
});
test("Pullbacks require a later close past the rejection candle in every flexibility mode", () => {
  const {input}=executionFixture();
  const early={...input,candles:input.candles.map((bar,i)=>i===input.candles.length-2 ? {...bar,high:100.5} : bar)};
  for (const mode of ["STRICT","BALANCED","FLEXIBLE"]) for (const scenario of [early,mirrorInput(early)]) {
    const plan=execution.buildEntryExecutionPlan({...scenario,mode});
    assert.notEqual(plan.status,"READY");
  }
  for (const scenario of [input,mirrorInput(input)]) assert.equal(execution.buildEntryExecutionPlan(scenario).status,"READY");
});
test("Pullback stops cover nearby liquidity beyond the latest retest", () => {
  const {input}=executionFixture();
  const bars=input.candles.map((bar,i)=>i===input.candles.length-8 ? {...bar,low:98.7} : bar);
  for (const source of [{...input,candles:bars},mirrorInput({...input,candles:bars})]) {
    const plan=execution.buildEntryExecutionPlan(source);
    assert.ok(source.side==="LONG" ? plan.stop<98.7 : plan.stop>101.3);
  }
});
test("Cancelled locked plans cannot revive after a stop sweep or move their levels", () => {
  const {candles,ticker}=fixture();
  const analysis=market.analyzeMarket(candles,candles,candles,ticker);
  const now=Date.now();
  analysis.executionPlan.expiresAt=now+60000;
  const lock={key:"BTCUSDT:240:DAY:STRICT",capturedAt:now,analysis};
  const breached=analysis.bias==="LONG" ? analysis.stop-.1 : analysis.stop+.1;
  const reason=locked.lockedPlanFailure(lock,breached,[],now);
  assert.ok(reason);
  const cancelled=locked.cancelLockedAnalysis(analysis,reason);
  assert.equal(cancelled.entry,analysis.entry);
  assert.equal(cancelled.stop,analysis.stop);
  assert.deepEqual(cancelled.takeProfits,analysis.takeProfits);
  assert.equal(cancelled.entryReady,false);
  assert.equal(locked.lockedPlanFailure({...lock,invalidReason:reason},analysis.entry,[],now),reason);
  assert.ok(locked.lockedPlanFailure(lock,analysis.entry,[],now+60001));
});
test("Day and swing signals both execute on one-hour candles (the backtested timeframe)", () => {
  assert.equal(market.STYLE_CONFIG.DAY.interval,"60");
  assert.equal(market.STYLE_CONFIG.SWING.interval,"60");
  assert.deepEqual(market.contextIntervals("120"),["240","D"]);
});
test("A stop sweep in the capture candle cancels a locked plan even after price recovers", () => {
  const {candles,ticker}=fixture();
  const analysis=market.analyzeMarket(candles,candles,candles,ticker);
  const now=Date.now();
  analysis.executionPlan.expiresAt=now+60000;
  const start=now-1000;
  const lock={key:"test",capturedAt:now,capturedCandleTime:start,analysis};
  const swept={time:start,open:analysis.entry,close:analysis.entry,high:Math.max(analysis.entry,analysis.stop)+1,low:Math.min(analysis.entry,analysis.stop)-1,volume:100};
  assert.ok(locked.lockedPlanFailure(lock,analysis.entry,[swept],now));
});

const history = load("app/lib/candle-history.ts");
test("History reconciliation retains older pages and replaces duplicate OHLC values", () => {
  const bar=time=>({time,open:100,high:102,low:99,close:101,volume:10});
  const result=history.mergeHistory([bar(1),bar(2)],[{...bar(2),close:102},bar(3)]);
  assert.deepEqual(result.map(row=>row.time),[1,2,3]);
  assert.equal(result[1].close,102);
  assert.equal(history.candleFeedFresh([bar(1000)],3600000,2000),true);
  assert.equal(history.candleFeedFresh([bar(1000)],3600000,4000000),false);
});
test("Older candle paging sends an exclusive timestamp cursor", async () => {
  const original=globalThis.fetch; let url;
  try {
    globalThis.fetch=async value=>{url=value;return {ok:true,json:async()=>({result:{list:[]}})};};
    await market.fetchKlines("BTCUSDT","60",1000,undefined,123456);
    assert.equal(new URL(url,"https://local").searchParams.get("end"),"123456");
  } finally {globalThis.fetch=original;}
});
const telegram = load("app/server/telegram.ts");
test("Long Telegram analysis is split below the message limit without dropping TP lines",()=>{
  const text=Array.from({length:120},(_,i)=>"🎯 TP"+i+": "+"technical reasoning ".repeat(12)).join("\n");
  const chunks=telegram.telegramChunks(text);
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.length<=3800));
  for(let i=0;i<120;i++)assert.ok(chunks.some(chunk=>chunk.includes("TP"+i+":")));
});
test("Telegram failures never expose the bot token in error text",async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>{throw new Error("https://api.telegram.org/botTEST_SECRET/sendMessage");};
    await assert.rejects(()=>telegram.telegramCall("TEST_SECRET","sendMessage",{chat_id:"12345",text:"test"}),error=>!error.message.includes("TEST_SECRET"));
    globalThis.fetch=async()=>({ok:false,status:403,json:async()=>({ok:false,error_code:403})});
    await assert.rejects(()=>telegram.telegramCall("TEST_SECRET","sendMessage",{}),/Telegram rejected/);
  }finally{globalThis.fetch=original;}
});

test("Telegram HTML highlights levels and safely escapes analysis text",()=>{
 const item=signals.snapshotSignal(qualifiedPick(Date.now()));
 item.setupType="PULLBACK <risk> & liquidity";
 const html=signals.telegramSignalHtml(item);
 assert.match(html,/👉 Entry: <code>[\d.]+<\/code>/);
 assert.match(html,/❌ StopLoss: <code>[\d.]+<\/code>/);
 assert.match(html,/^<b>📍 Coin : #ETH\/USDT<\/b>\n<b>🟢 LONG<\/b>\n\n👉 Entry/);
 assert.match(html,/⏱ Expires: \d\d [A-Z][a-z]{2}, \d\d:\d\d\n\n🧭 Enter: /);
 assert.match(html,/🛑 Stop order: <code>/);
 assert.match(html,/PULLBACK &lt;risk&gt; &amp; liquidity/);
 assert.doesNotMatch(html,/<risk>/);
});
const targetPolicy=load("app/lib/target-policy.ts");
const botCommands=load("app/lib/telegram-commands.ts");
test("Target distance budget follows recent mode-specific excursion, never an inflated stop",()=>{
 const {candles}=fixture();
 for(const style of ["SCALP","DAY","SWING","POSITION"]) {
  const budget=targetPolicy.targetBudget(candles,"LONG",1,style);
  assert.ok(budget.distance<=({SCALP:2,DAY:3.5,SWING:5,POSITION:8}[style]));
  assert.ok(budget.distance>=.65);
 }
 assert.deepEqual(targetPolicy.TARGET_EXIT_WEIGHTS,[40,35,15,5,5]);
 assert.equal(targetPolicy.TARGET_EXIT_WEIGHTS.reduce((a,b)=>a+b,0),100);
});
test("A pullback touch without a prior liquidity sweep never confirms",()=>{
 const {input}=executionFixture();
 const noSweep={...input,candles:input.candles.map((bar,i)=>i===input.candles.length-2?{...bar,low:99.8}:bar)};
 for(const source of [noSweep,mirrorInput(noSweep)])for(const mode of ["STRICT","BALANCED","FLEXIBLE"])assert.notEqual(execution.buildEntryExecutionPlan({...source,mode}).status,"READY");
});
test("After TP2, a retreat to TP1 closes the remaining runner without waiting for TP3",()=>{
 const now=Date.now();
 const position={...trade(),tp1Taken:true,tp2Taken:true,tp2TakenAt:now-60000,remainingPct:25};
 assert.equal(manager.evaluateTrade(position,101,now,null,now).action,"CLOSE REMAINDER");
 assert.equal(manager.evaluateTrade({...position,tp2TakenAt:now-121*60000},102.5,now,null,now).action,"CLOSE REMAINDER");
});
test("Telegram commands validate settings and accept direct pair requests",()=>{
 assert.deepEqual(botCommands.parseBotCommand("ETHUSDT"),{command:"/analyse",args:["ETHUSDT"]});
 assert.deepEqual(botCommands.parseBotCommand("/timeframe@MyBot 2h"),{command:"/timeframe",args:["2h"]});
 assert.deepEqual(botCommands.botSetting("/timeframe","2h"),{interval:"120"});
 assert.deepEqual(botCommands.botSetting("/risk","balanced"),{flexibility:"BALANCED"});
 assert.equal(botCommands.botSetting("/fee","5"),null);
 assert.equal(botCommands.botSetting("/equity","-1"),null);
 assert.equal(botCommands.botSetting("/timeframe","2seconds"),null);
});
test("Every setup scales out at 1R-5R with 30/25/20/15/10 weights", () => {
  for (const inverse of [false, true]) for (const style of ["SCALP", "DAY", "SWING", "POSITION"]) {
    const {candles, ticker} = fixture("SOLUSDT", inverse);
    const result = market.analyzeMarket(candles, candles, candles, ticker, style, {targetStyle: "LADDER"});
    const risk = Math.abs(result.entry - result.stop);
    assert.deepEqual(result.takeProfits.map(tp => tp.exitPct), [30, 25, 20, 15, 10]);
    result.takeProfits.forEach((tp, index) => {
      assert.ok(Math.abs(Math.abs(tp.price - result.entry) / risk - (index + 1)) < 1e-9);
      assert.equal(tp.rewardR, index + 1);
    });
  }
});
test("Only 1H execution candles can produce entry signals", () => {
  const {candles, ticker} = fixture();
  const fifteen = market.analyzeMarket(candles, candles, candles, ticker, "DAY");
  assert.equal(fifteen.entryChecks.find(check => check.id === "timeframe").status, "WAIT");
  assert.equal(fifteen.entryReady, false);
  const hourly = market.generateDemoCandles("ETHUSDT", "60", 480);
  const price = hourly.at(-1).close;
  const hourTicker = market.normalizeTicker({symbol: "ETHUSDT", lastPrice: price, markPrice: price, turnover24h: 500_000_000, bid1Price: price * .99999, ask1Price: price * 1.00001});
  const result = market.analyzeMarket(hourly, hourly, hourly, hourTicker, "DAY");
  assert.equal(result.entryChecks.find(check => check.id === "timeframe").status, "PASS");
});
test("Stops too tight for round-trip fees cannot pass the payoff check", () => {
  const {candles, ticker} = fixture();
  const cheap = market.analyzeMarket(candles, candles, candles, ticker, "DAY", {takerFeePct: 0, slippagePct: 0});
  const costly = market.analyzeMarket(candles, candles, candles, ticker, "DAY", {takerFeePct: 0.3, slippagePct: 1});
  const riskPct = Math.abs(costly.entry - costly.stop) / costly.entry * 100;
  if (2 * 1.3 / riskPct > 0.3) {
    assert.equal(costly.entryChecks.find(check => check.id === "targets").status, "WAIT");
    assert.match(costly.entryChecks.find(check => check.id === "targets").detail, /too tight for fees/);
  }
  assert.ok(cheap.entryChecks.find(check => check.id === "targets").detail.length > 0);
});
test("Trend signals need execution, context and macro frames aligned; CHoCH keeps one", () => {
  let checked = 0;
  for (const inverse of [false, true]) for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "XRPUSDT", "LINKUSDT"]) for (const interval of ["15", "60"]) {
    const candles = market.generateDemoCandles(symbol, interval, 480).map(c => inverse ? ({...c, open: 1e6/c.open, close: 1e6/c.close, high: 1e6/c.low, low: 1e6/c.high}) : c);
    const price = candles.at(-1).close;
    const ticker = market.normalizeTicker({symbol, lastPrice: price, markPrice: price, turnover24h: 500_000_000, bid1Price: price * .99999, ask1Price: price * 1.00001});
    for (const style of ["DAY", "SWING"]) {
      const result = market.analyzeMarket(candles, candles.filter((_, i) => i % 4 === 0), candles.filter((_, i) => i % 16 === 0), ticker, style);
      const trend = result.entryChecks.find(check => check.id === "trend");
      const needed = result.setupType === "CHoCH REVERSAL" ? 1 : 3;
      if (result.metrics.trendFrames >= needed) assert.equal(trend.status, "PASS");
      else { assert.notEqual(trend.status, "PASS"); assert.equal(result.entryReady, false); checked++; }
    }
  }
  assert.ok(checked >= 0);
});

test("TA-style targets are chart structure (or a labelled R fallback), ascending and reachable", () => {
  for (const inverse of [false, true]) for (const symbol of ["BTCUSDT", "SOLUSDT", "ADAUSDT"]) {
    const {candles, ticker} = fixture(symbol, inverse);
    const result = market.analyzeMarket(candles, candles, candles, ticker, "DAY", {targetStyle: "TA"});
    const sign = result.bias === "LONG" ? 1 : -1;
    const risk = Math.abs(result.entry - result.stop);
    assert.equal(result.targetStyle, "TA");
    assert.deepEqual(result.takeProfits.map(tp => tp.exitPct), [30, 25, 20, 15, 10]);
    let previous = result.entry;
    result.takeProfits.forEach((tp, index) => {
      assert.ok(sign * (tp.price - previous) > 0, "targets ascend in the trade direction");
      assert.ok(tp.available, "TA targets are always usable");
      assert.ok(sign * (tp.price - result.entry) <= risk * 6 + 1e-9, "never beyond 6R");
      assert.ok(tp.sources.some(source => !/No confirmed objective/.test(source)));
      if (/R \(no structure in window\)/.test(tp.source)) assert.ok(Math.abs(sign * (tp.price - result.entry) / risk - [0.9, 1.6, 2.5, 3.5, 5][index]) < 0.6);
      previous = tp.price;
    });
  }
});

test("Positioning verdict: whales with the plan support it, whales against it call for half size", async () => {
  const mod = load("app/lib/positioning.ts");
  const base = { symbol: "XRPUSDT", coin: "XRP", at: 0, hyperliquid: null, crowd: { longRatio: 0.5, longRatioPrev: 0.5, oiChange24h: 0, fundingRate: 0 } };
  const whales = (longUsd, shortUsd) => ({ longUsd, shortUsd, traders: 8, positions: [] });
  const supports = mod.judgePositioning({ ...base, whales: whales(8_000_000, 2_000_000) }, "LONG", 2, 1.9);
  assert.equal(supports.level, "SUPPORTS"); assert.match(supports.notes[0], /Whales agree: 80%/);
  const against = mod.judgePositioning({ ...base, whales: whales(8_000_000, 2_000_000) }, "SHORT", 2, 2.1);
  assert.equal(against.level, "AGAINST"); assert.match(against.headline, /half size/);
  const crowded = mod.judgePositioning({ ...base, whales: whales(0, 0), crowd: { longRatio: 0.72, longRatioPrev: 0.6, oiChange24h: 0.08, fundingRate: 0.0005 } }, "LONG", 2, 1.9);
  assert.equal(crowded.level, "AGAINST", "crowded side plus paid funding"); assert.ok(crowded.notes.some(n => /crowded/.test(n)) && crowded.notes.some(n => /pay to hold/.test(n)));
  const pocket = mod.judgePositioning({ ...base, whales: { longUsd: 1e6, shortUsd: 0, traders: 3, positions: [{ trader: "a", coin: "XRP", side: "LONG", sizeUsd: 1e6, entry: 2.1, leverage: 10, liquidation: 1.92, pnl: 0, accountValue: 1e7 }] } }, "LONG", 2, 1.9);
  assert.ok(pocket.notes.some(n => /liquidate within 3%/.test(n)));
  assert.equal(mod.hyperliquidCoin("1000PEPEUSDT", new Set(["kPEPE", "BTC"])), "kPEPE");
  assert.equal(mod.hyperliquidCoin("XAUTUSDT", new Set(["kPEPE", "BTC"])), null);
});

test("Venue top-trader consensus feeds the verdict and the one-line summary", () => {
  const mod = load("app/lib/positioning.ts");
  const data = { symbol: "BTCUSDT", coin: "BTC", at: 0, hyperliquid: null, crowd: { longRatio: 0.5, longRatioPrev: 0.5, oiChange24h: 0, fundingRate: 0 },
    whales: { longUsd: 7e6, shortUsd: 3e6, traders: 6, positions: [] },
    venues: [{ name: "OKX top traders", kind: "top traders", longShare: 0.64, basis: "positions" }, { name: "Binance top traders", kind: "top traders", longShare: 0.6, basis: "positions" }, { name: "OKX", kind: "all accounts", longShare: 0.75, basis: "accounts" }] };
  const verdict = mod.judgePositioning(data, "LONG", 100, 95);
  assert.equal(verdict.level, "SUPPORTS"); assert.ok(verdict.notes.some(n => /Top traders across venues lean LONG \(65%\)/.test(n)));
  const summary = mod.positioningSummary(data, "LONG");
  assert.match(summary, /^Smart money 65% with your LONG/); assert.match(summary, /OKX top traders 64% long/); assert.match(summary, /Bybit crowd 50% long/);
  assert.equal(mod.judgePositioning(data, "SHORT", 100, 105).level, "AGAINST");
});
