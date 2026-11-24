/**
 * Resolves whatever the user typed or tapped (BTC, btcusdt, kPEPE, KPEPE, 1000PEPE, PEPE) to a real Bybit USDT perpetual.
 * Bybit lists small-priced coins as 1000X / 10000X / 1000000X; Hyperliquid calls the same coins kX.
 * Returns null when no such pair trades on Bybit, so nothing is analysed under a made-up symbol.
 */
export function resolveBybitSymbol(input: string, symbols: Set<string>): string | null {
  const clean = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/USDT$/, ""); if (!clean) return null;
  const bases = [clean, ...(clean.startsWith("K") && clean.length > 2 ? [clean.slice(1)] : [])];
  const candidates = bases.flatMap((b, i) => i === 0 ? [b, "1000" + b, "10000" + b, "1000000" + b] : ["1000" + b, "10000" + b, "1000000" + b, b]);
  return candidates.map(c => c + "USDT").find(s => symbols.has(s)) ?? null;
}
