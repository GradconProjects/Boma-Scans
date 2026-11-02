import type { Candle } from "@/app/lib/market";
export function mergeHistory(previous: Candle[], incoming: Candle[]) {
  const bars = new Map(previous.map(bar => [bar.time, bar]));
  for (const bar of incoming) bars.set(bar.time, bar);
  return [...bars.values()].sort((a,b) => a.time-b.time);
}
export function candleFeedFresh(bars: Candle[], duration: number, now: number) {
  const latest=bars.at(-1);
  return !!latest && latest.time <= now && now < latest.time+duration+10_000;
}
