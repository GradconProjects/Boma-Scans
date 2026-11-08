/**
 * Server environment for Vercel hosting.
 *
 * `env.DB` exposes the small subset of the Cloudflare D1 statement API that the
 * routes use (`prepare().bind().first()/all()/run()`), so the sync and Telegram
 * routes run unchanged. Two drivers are supported, chosen by the connection URL:
 *
 *   - Supabase / any Postgres: POSTGRES_URL or DATABASE_URL (postgres://...)
 *     Use Supabase's transaction pooler URL (port 6543). The Vercel Supabase
 *     integration sets POSTGRES_URL automatically.
 *   - Turso / libSQL / local file: TURSO_DATABASE_URL (libsql://... or file:local.db)
 *
 * The SQL in the routes is written in the dialect both databases share:
 * `?` placeholders (rewritten to $1.. for Postgres), quoted "offset", CASE
 * instead of scalar MAX, and 64-bit integer timestamps.
 */
type Row = Record<string, unknown>;
export type ExecuteResult = { rows: Row[]; rowsAffected: number };
export type Execute = (sql: string, args: unknown[]) => Promise<ExecuteResult>;

/** `?` → `$1, $2, ...` for Postgres. The app's SQL never puts `?` inside a string literal. */
export function toPositional(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => "$" + ++index);
}

function normalize(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = typeof value === "bigint" ? Number(value) : value;
  return out;
}

const STATEMENT_TIMEOUT_MS = 12_000;
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Database " + label + " timed out after " + STATEMENT_TIMEOUT_MS / 1000 + "s.")), STATEMENT_TIMEOUT_MS);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export class Statement {
  constructor(private readonly execute: () => Promise<Execute>, private readonly sql: string, private readonly args: unknown[] = []) {}
  private async run_() {
    try { return await withTimeout(this.execute().then(execute => execute(this.sql, this.args)), "statement"); }
    catch (error) {
      // A wedged pooled connection would otherwise block every later query on this
      // instance (one connection per instance), so drop it and reconnect next time.
      if (error instanceof Error && /timed out/.test(error.message)) await resetConnection();
      throw error;
    }
  }
  bind(...args: unknown[]) {
    return new Statement(this.execute, this.sql, args.map(value => (value === undefined ? null : value)));
  }
  async first<T = Row>(): Promise<T | null> {
    const result = await this.run_();
    return result.rows[0] ? (normalize(result.rows[0]) as T) : null;
  }
  async all<T = Row>(): Promise<{ results: T[] }> {
    const result = await this.run_();
    return { results: result.rows.map(normalize) as T[] };
  }
  async run() {
    const result = await this.run_();
    return { success: true, meta: { changes: result.rowsAffected } };
  }
}

export type Database = { prepare(sql: string): Statement };

export function makeDatabase(execute: () => Promise<Execute>): Database {
  return { prepare: (sql: string) => new Statement(execute, sql) };
}

export const POSTGRES_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS account_records (user_id text NOT NULL, record_key text NOT NULL, payload text NOT NULL, revision integer NOT NULL, updated_at bigint NOT NULL, PRIMARY KEY(user_id, record_key))",
  "CREATE TABLE IF NOT EXISTS telegram_deliveries (user_id text NOT NULL, signal_key text NOT NULL, status text NOT NULL, created_at bigint NOT NULL, PRIMARY KEY(user_id, signal_key))",
  "CREATE TABLE IF NOT EXISTS telegram_runtime (id text PRIMARY KEY NOT NULL, \"offset\" bigint NOT NULL, lease_until bigint NOT NULL)",
  "CREATE TABLE IF NOT EXISTS telegram_updates (id bigint PRIMARY KEY NOT NULL, received_at bigint NOT NULL)",
  "CREATE TABLE IF NOT EXISTS login_attempts (key text PRIMARY KEY NOT NULL, attempts integer NOT NULL, expires_at bigint NOT NULL)",
  "CREATE TABLE IF NOT EXISTS whale_events (id text PRIMARY KEY NOT NULL, at bigint NOT NULL, trader text NOT NULL, coin text NOT NULL, kind text NOT NULL, side text NOT NULL, size_usd double precision NOT NULL, delta_usd double precision NOT NULL, entry double precision NOT NULL, price double precision NOT NULL, pnl double precision NOT NULL, held_ms bigint NOT NULL)",
  // Supabase exposes public tables through its REST API; RLS with no policies keeps these private to the app's own connection.
  ...["account_records", "telegram_deliveries", "telegram_runtime", "telegram_updates", "login_attempts", "whale_events"].map(table => "ALTER TABLE " + table + " ENABLE ROW LEVEL SECURITY"),
];

export const SQLITE_SCHEMA = POSTGRES_SCHEMA.filter(statement => statement.startsWith("CREATE")).map(statement => statement.replaceAll(" bigint ", " integer ").replaceAll(" double precision ", " real "));

const DATABASE_URL_KEYS = ["POSTGRES_URL", "DATABASE_URL", "TURSO_DATABASE_URL"] as const;
function databaseUrl() {
  for (const key of DATABASE_URL_KEYS) if (process.env[key]) return process.env[key] as string;
  return "";
}

async function postgresExecute(url: string): Promise<Execute> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, {
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
    prepare: false, // required by Supabase's transaction pooler
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    types: { bigint: { to: 20, from: [20], serialize: (value: number | bigint) => String(value), parse: (value: string) => Number(value) } },
  });
  const tables = ["account_records", "telegram_deliveries", "telegram_runtime", "telegram_updates", "login_attempts", "whale_events"];
  const existing = await withTimeout(sql.unsafe("SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = ANY($1)", [tables]), "schema check");
  const known = new Map(Array.from(existing as unknown as Array<{ name: string; rls: boolean }>).map(row => [row.name, row.rls]));
  for (const statement of POSTGRES_SCHEMA) {
    const create = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement);
    const alter = /^ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY$/.exec(statement);
    if (create && known.has(create[1])) continue;
    if (alter && known.get(alter[1]) === true) continue;
    await withTimeout(sql.unsafe(statement), "schema setup");
  }
  globalState.__bomaClose = () => sql.end({ timeout: 1 }).catch(() => undefined);
  return async (query, args) => {
    const result = await sql.unsafe(toPositional(query), args as never);
    return { rows: Array.from(result) as Row[], rowsAffected: result.count };
  };
}

async function libsqlExecute(url: string): Promise<Execute> {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
  for (const statement of SQLITE_SCHEMA) await client.execute(statement);
  return async (query, args) => {
    const result = await client.execute({ sql: query, args: args as never });
    return { rows: result.rows as unknown as Row[], rowsAffected: result.rowsAffected };
  };
}

// Survive hot reloads in development without re-creating connections.
const globalState = globalThis as unknown as { __bomaExecute?: Promise<Execute>; __bomaClose?: () => Promise<void> };

/** Forget the current connection so the next statement opens a fresh one. */
export async function resetConnection() {
  const close = globalState.__bomaClose;
  delete globalState.__bomaExecute; delete globalState.__bomaClose;
  if (close) await close();
}

function connect(): Promise<Execute> {
  if (!globalState.__bomaExecute) {
    const url = databaseUrl();
    globalState.__bomaExecute = url.startsWith("postgres") ? postgresExecute(url) : libsqlExecute(url);
    globalState.__bomaExecute.catch(() => { delete globalState.__bomaExecute; });
  }
  return globalState.__bomaExecute;
}

const database = makeDatabase(connect);

export const env = {
  get DB(): Database | undefined {
    return databaseUrl() ? database : undefined;
  },
  get BOMA_SYNC_SECRET() { return process.env.BOMA_SYNC_SECRET; },
  get TELEGRAM_BOT_TOKEN() { return process.env.TELEGRAM_BOT_TOKEN; },
  get TELEGRAM_CHAT_ID() { return process.env.TELEGRAM_CHAT_ID; },
  get TELEGRAM_OWNER_EMAIL() { return process.env.TELEGRAM_OWNER_EMAIL; },
};
