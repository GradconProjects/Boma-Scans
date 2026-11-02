import { run, line, DESIGNS } from "./sim2.mjs";
import { readFileSync } from "node:fs";
const files = process.argv.slice(3);
const data = files.map(f => JSON.parse(readFileSync(f, "utf8")));
const all = data.flatMap(d => d.candidates).filter(c => c.ready && c.btc !== "REJECT");
const CUT = 1758067200000;
console.log("evaluated", data.reduce((a,d)=>a+d.evaluated,0), "engine READY signals", all.length);
for (const [cn, cost] of Object.entries({"limit (maker) entry/TP": {entry: 0.02, tp: 0.02, stop: 0.075}, "market (taker) all": {entry: 0.075, tp: 0.075, stop: 0.075}})) {
  const rs = run(all, DESIGNS["engine (current W-Telegram)"], cost);
  console.log(line("fees: " + cn, rs), "| OOS yr", line("", rs.filter(x=>x.t<CUT)).slice(40), "| tune yr", line("", rs.filter(x=>x.t>=CUT)).slice(40));
  const months = {}; for (const r of rs) { const m = new Date(r.t).toISOString().slice(0,7); months[m] = (months[m] ?? 0) + r.r; }
  const vals = Object.values(months); console.log("   months", vals.length, "positive months", vals.filter(v=>v>0).length, "worst month R", Math.min(...vals).toFixed(1), "best", Math.max(...vals).toFixed(1));
  let eq = 0, peak = 0, dd = 0; for (const r of [...rs].sort((a,b)=>a.t-b.t)) { eq += r.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  console.log("   max drawdown (R)", dd.toFixed(1), " total R", eq.toFixed(1));
}
