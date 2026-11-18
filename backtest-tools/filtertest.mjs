import { run, DESIGNS } from "./sim2.mjs";
import { readFileSync } from "node:fs";
const files = process.argv.slice(3);
const all = files.flatMap(f => { const d = JSON.parse(readFileSync(f, "utf8")); return d.candidates.filter(c => c.ready && c.btc !== "REJECT"); });
const rs = run(all, DESIGNS["engine (current W-Telegram)"], { entry: 0.02, tp: 0.02, stop: 0.075 });
const CUT = 1758067200000;
const melb = t => { const d = new Date(t); const m = d.getUTCMonth(); const offset = (m >= 9 || m <= 2) || (m === 3 && d.getUTCDate() < 5) ? 11 : 10; return { hour: (d.getUTCHours() + offset) % 24, dow: new Date(t + offset * 3.6e6).getUTCDay() }; };
const stat = (arr) => { const n = arr.length; if (!n) return "n=0"; const tot = arr.reduce((a, r) => a + r.r, 0); const w = arr.filter(r => r.r > 0).length; const gw = arr.filter(r => r.r > 0).reduce((a, r) => a + r.r, 0), gl = -arr.filter(r => r.r < 0).reduce((a, r) => a + r.r, 0); const avg = x => x.length ? (x.reduce((a, r) => a + r.r, 0) / x.length).toFixed(2) : "-"; let eq = 0, peak = 0, dd = 0; for (const r of [...arr].sort((a, b) => a.t - b.t)) { eq += r.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); } return `n=${String(n).padStart(4)} win=${String(Math.round(w / n * 100)).padStart(3)}% avgR=${(tot / n).toFixed(2).padStart(6)} totR=${tot.toFixed(1).padStart(7)} PF=${gl ? (gw / gl).toFixed(2) : "inf"} maxDD=${dd.toFixed(1)}  yr1=${avg(arr.filter(r => r.t < CUT)).padStart(5)} yr2=${avg(arr.filter(r => r.t >= CUT)).padStart(5)}`; };
const filters = {
  "baseline": () => true,
  "skip Mon+Tue": r => ![1, 2].includes(melb(r.t).dow),
  "skip 03:00-10:00 dead zone": r => !(melb(r.t).hour >= 3 && melb(r.t).hour < 10),
  "skip both": r => ![1, 2].includes(melb(r.t).dow) && !(melb(r.t).hour >= 3 && melb(r.t).hour < 10),
  "skip both + score>=75": r => ![1, 2].includes(melb(r.t).dow) && !(melb(r.t).hour >= 3 && melb(r.t).hour < 10) && r.score >= 75,
  "only 18:00-03:00 window": r => melb(r.t).hour >= 18 || melb(r.t).hour < 3,
  "only 18:00-03:00 + skip Mon/Tue": r => (melb(r.t).hour >= 18 || melb(r.t).hour < 3) && ![1, 2].includes(melb(r.t).dow),
};
for (const [name, f] of Object.entries(filters)) console.log(name.padEnd(34), stat(rs.filter(f)));
