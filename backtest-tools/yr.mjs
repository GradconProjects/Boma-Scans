import { run, line, DESIGNS } from "./sim2.mjs";
import { readFileSync } from "node:fs";
const files = process.argv.slice(3);
const all = files.flatMap(f => JSON.parse(readFileSync(f, "utf8")).candidates).filter(c => c.btc !== "REJECT");
const CUT = 1758067200000; // start of the tuning year (2025-09-17)
const costs = {maker: {entry: 0.02, tp: 0.02, stop: 0.075}, taker: {entry: 0.075, tp: 0.075, stop: 0.075}};
const rules = {"no filter": c => true, "NEW RULES (stop>=0.5% & TRENDING)": c => c.riskPct >= 0.5 && c.regime === "TRENDING"};
for (const dn of ["engine (current W-Telegram)", "R 1/1.5/2/3/4 w40/35/15/5/5", "R 1/2/3/4/5 w30/25/20/15/10", "R 1.5/2.5/3.5/5/7 w25/25/20/15/15"]) for (const [cn, cost] of Object.entries(costs)) {
  console.log("### " + dn + " | fees " + cn);
  for (const [rn, f] of Object.entries(rules)) { const rs = run(all.filter(f), DESIGNS[dn], cost);
    console.log(line(rn, rs), "| OOS yr", line("", rs.filter(x=>x.t<CUT)).slice(40), "| tune yr", line("", rs.filter(x=>x.t>=CUT)).slice(40)); }
}
