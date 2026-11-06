/**
 * In-memory fallback for single-owner hosting without a database. State lives
 * for the life of one serverless instance only: good enough for login rate
 * limiting, Telegram command offsets and delivery de-duplication; cross-device
 * sync still needs a database.
 */
const state = globalThis as unknown as {
  __bomaMemory?: { records: Map<string, { payload: string; revision: number; updatedAt: number }>; deliveries: Map<string, number>; updates: Map<number, number>; attempts: Map<string, { attempts: number; expiresAt: number }>; runtime: { offset: number; leaseUntil: number } };
};
export function memory() {
  state.__bomaMemory ??= { records: new Map(), deliveries: new Map(), updates: new Map(), attempts: new Map(), runtime: { offset: 0, leaseUntil: 0 } };
  const m = state.__bomaMemory;
  const now = Date.now();
  for (const [key, at] of m.deliveries) if (now - at > 6 * 3_600_000) m.deliveries.delete(key);
  for (const [key, at] of m.updates) if (now - at > 3_600_000) m.updates.delete(key);
  for (const [key, row] of m.attempts) if (row.expiresAt < now) m.attempts.delete(key);
  return m;
}
export function recordKey(userId: string, key: string) { return userId + "\u0000" + key; }
