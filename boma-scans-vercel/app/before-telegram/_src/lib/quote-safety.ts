/** Exchange timestamps, not HTTP arrival order, decide which quote is newest. */
export function quoteIsFresh(updatedAt: number | null | undefined, now = Date.now()) {
  return Number.isFinite(updatedAt) && Number(updatedAt) > 0 &&
    Number(updatedAt) <= now + 5_000 && now - Number(updatedAt) <= 15_000;
}

export function acceptQuote(previousTime: number | null | undefined, incomingTime: number, price: number, now = Date.now()) {
  return Number.isFinite(price) && price > 0 && quoteIsFresh(incomingTime, now) &&
    incomingTime >= (previousTime ?? 0);
}
