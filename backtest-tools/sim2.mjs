import { readFileSync } from "node:fs";
// usage: node sim2.mjs data.json cand1.json [cand2.json ...]
const dataFile = process.argv[2]; const candFiles = process.argv[1].endsWith("sim2.mjs") ? process.argv.slice(3) : process.argv.slice(4);
const data = JSON.parse(readFileSync(dataFile, "utf8"));
const all = candFiles.flatMap(f => { const d = JSON.parse(readFileSync(f, "utf8")); return d.candidates.map(c => ({...c, style: d.style})); });
const style = process.env.STYLE ?? all[0]?.style; const bar = process.env.BAR ?? {SCALP:"5m", DAY:"15m", SWING:"1H"}[style];
const barMin = {"5m":5, "15m":15, "1H":60, "4H":240}[bar];
const MAXHOLD = {"5m": 36, "15m": 48, "1H": 72, "4H": 42}[bar];            // 3h / 12h / 3d / 7d
const RUNNER = Math.max(1, Math.round({SCALP: 15, DAY: 120, SWING: 720, POSITION: 720}[style] / barMin)); // app runner timeout after TP2
const COSTS = { taker: {entry: 0.075, tp: 0.075, stop: 0.075}, maker: {entry: 0.02, tp: 0.02, stop: 0.075} }; // % of notional per side
export function simulate(c, tps, weights, cost) {
  const F = data[c.sym][bar]; const sign = c.side === "LONG" ? 1 : -1;
  const risk = Math.abs(c.entry - c.stop); let remaining = 1, pnl = 0, tp2At = null, hit = 0, k = 0;
  const R = price => sign * (price - c.entry) / risk; const fee = pct => pct / 100 * c.entry / risk;
  pnl -= fee(cost.entry);
  let exitK = MAXHOLD;
  for (k = 0; k < MAXHOLD && c.i + k < F.length; k++) {
    const [, o, h, l, cl] = F[c.i + k];
    const adverse = sign > 0 ? l : h, favourable = sign > 0 ? h : l;
    if (sign * (adverse - c.stop) <= 0) { const px = k > 0 && sign*(o-c.stop) <= 0 ? o : c.stop; pnl += remaining * (R(px) - fee(cost.stop)); remaining = 0; exitK = k; break; }
    while (hit < 5 && sign * (favourable - tps[hit]) >= 0) { const w = weights[hit] / 100; pnl += w * (R(tps[hit]) - fee(cost.tp)); remaining -= w; hit++; if (hit === 2) tp2At = k; }
    if (remaining <= 1e-9) { exitK = k; break; }
    if (hit === 2 && (sign * (cl - tps[0]) <= 0 || k - tp2At >= RUNNER)) { pnl += remaining * (R(cl) - fee(cost.stop)); remaining = 0; exitK = k; break; }
  }
  if (remaining > 1e-9) { const last = F[Math.min(F.length-1, c.i + MAXHOLD - 1)][4]; pnl += remaining * (R(last) - fee(cost.stop)); }
  return {r: pnl, exit: c.i + exitK, tp1: hit >= 1};
}
const ladder = (lad, w) => c => { const s = c.side==="LONG"?1:-1, r = Math.abs(c.entry-c.stop); return [lad.map(k=>c.entry+s*k*r), w]; };
export const DESIGNS = {
  "engine (current W-Telegram)": c => [c.tps.map(t=>t.p), c.tps.map(t=>t.w)],
  "R 0.8/1.2/1.6/2.2/3 w40/30/15/10/5": ladder([0.8,1.2,1.6,2.2,3],[40,30,15,10,5]),
  "R 1/1.5/2/3/4 w40/35/15/5/5": ladder([1,1.5,2,3,4],[40,35,15,5,5]),
  "R 1/1.5/2/3/4 w30/25/20/15/10": ladder([1,1.5,2,3,4],[30,25,20,15,10]),
  "R 1/2/3/4/5 w30/25/20/15/10": ladder([1,2,3,4,5],[30,25,20,15,10]),
  "R 1.5/2.5/3.5/5/7 w25/25/20/15/15": ladder([1.5,2.5,3.5,5,7],[25,25,20,15,15]),
};
export function run(cands, design, cost) {
  const sorted = [...cands].sort((a,b) => a.t - b.t); const busy = {}; const res = [];
  for (const c of sorted) { if (busy[c.sym] !== undefined && c.i <= busy[c.sym]) continue; const s = simulate(c, ...design(c), cost); busy[c.sym] = s.exit; res.push({...c, ...s}); }
  return res;
}
export function line(name, rs) {
  if (!rs.length) return name.padEnd(40) + " n=0";
  const v = rs.map(x => x.r), tot = v.reduce((a,b)=>a+b,0), gw = v.filter(x=>x>0).reduce((a,b)=>a+b,0), gl = -v.filter(x=>x<0).reduce((a,b)=>a+b,0);
  return name.padEnd(40) + " n=" + String(v.length).padStart(5) + " win%=" + (100*v.filter(x=>x>0).length/v.length).toFixed(0).padStart(3) +
    " avgR=" + (tot/v.length).toFixed(3).padStart(7) + " totR=" + tot.toFixed(0).padStart(6) + " PF=" + (gw/Math.max(gl,1e-9)).toFixed(2);
}
if (process.argv[1].endsWith("sim2.mjs")) {
  const base = all.filter(c => c.btc !== "REJECT");
  const split = (() => { const ts = base.map(c=>c.t).sort((a,b)=>a-b); return ts[ts.length>>1]; })();
  console.log(style, "candidates", all.length, "excl. BTC-REJECT", base.length, "split at", new Date(split).toISOString().slice(0,10));
  for (const [cn, cost] of Object.entries(COSTS)) {
    console.log("--- cost model:", cn);
    for (const [dn, d] of Object.entries(DESIGNS)) { const rs = run(base, d, cost); console.log(line(dn, rs), "| H1", line("", rs.filter(x=>x.t<split)).slice(40), "| H2", line("", rs.filter(x=>x.t>=split)).slice(40)); }
  }
}
