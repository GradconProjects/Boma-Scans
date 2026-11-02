import { createClient, type Client, type InValue } from "@libsql/client";

/**
 * Server environment for Vercel hosting.
 *
 * `DB` exposes the small subset of the Cloudflare D1 statement API that the
 * routes use (`prepare().bind().first()/all()/run()`), backed by libSQL/Turso.
 * Keeping the same shape means the sync and Telegram routes run unchanged.
 */
type Row = Record<string, unknown>;

export class Statement {
  constructor(private readonly client: () => Promise<Client>, private readonly sql: string, private readonly args: InValue[] = []) {}
  bind(...args: unknown[]) {
    return new Statement(this.client, this.sql, args.map(value => (value === undefined ? null : value) as InValue));
  }
  async first<T = Row>(): Promise<T | null> {
    const result = await (await this.client()).execute({ sql: this.sql, args: this.args });
    return (result.rows[0] as T | undefined) ?? null;
  }
  async all<T = Row>(): Promise<{ results: T[] }> {
    const result = await (await this.client()).execute({ sql: this.sql, args: this.args });
    return { results: result.rows as T[] };
  }
  async run() {
    const result = await (await this.client()).execute({ sql: this.sql, args: this.args });
    return { success: true, meta: { changes: result.rowsAffected } };
  }
}

export type Database = { prepare(sql: string): Statement };

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS account_records (user_id text NOT NULL, record_key text NOT NULL, payload text NOT NULL, revision integer NOT NULL, updated_at integer NOT NULL, PRIMARY KEY(user_id, record_key))",
  "CREATE TABLE IF NOT EXISTS telegram_deliveries (user_id text NOT NULL, signal_key text NOT NULL, status text NOT NULL, created_at integer NOT NULL, PRIMARY KEY(user_id, signal_key))",
  "CREATE TABLE IF NOT EXISTS telegram_runtime (id text PRIMARY KEY NOT NULL, offset integer NOT NULL, lease_until integer NOT NULL)",
  "CREATE TABLE IF NOT EXISTS telegram_updates (id integer PRIMARY KEY NOT NULL, received_at integer NOT NULL)",
  "CREATE TABLE IF NOT EXISTS login_attempts (key text PRIMARY KEY NOT NULL, attempts integer NOT NULL, expires_at integer NOT NULL)",
];

// Survive hot reloads in development without re-creating clients.
const globalState = globalThis as unknown as { __bomaDb?: Promise<Client> };

function connect(): Promise<Client> {
  if (!globalState.__bomaDb) {
    const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    globalState.__bomaDb = (async () => {
      const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
      for (const statement of SCHEMA) await client.execute(statement);
      return client;
    })();
    globalState.__bomaDb.catch(() => { delete globalState.__bomaDb; });
  }
  return globalState.__bomaDb;
}

const database: Database = { prepare: (sql: string) => new Statement(connect, sql) };

export const env = {
  get DB(): Database | undefined {
    return process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL ? database : undefined;
  },
  get BOMA_SYNC_SECRET() { return process.env.BOMA_SYNC_SECRET; },
  get TELEGRAM_BOT_TOKEN() { return process.env.TELEGRAM_BOT_TOKEN; },
  get TELEGRAM_CHAT_ID() { return process.env.TELEGRAM_CHAT_ID; },
  get TELEGRAM_OWNER_EMAIL() { return process.env.TELEGRAM_OWNER_EMAIL; },
};
