// Runs the app's SQL through the Postgres path (as used with Supabase) on an
// in-process Postgres (PGlite), via the same D1-shaped adapter the routes use.
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const mod = new Module(file);
  mod.require = spec => (spec in mocks ? mocks[spec] : require(spec));
  mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return mod.exports;
}
const envModule = load(new URL("../app/server/env.ts", import.meta.url).pathname);
const pg = new PGlite();
for (const statement of envModule.POSTGRES_SCHEMA) await pg.exec(statement);
const execute = async (sql, args) => { const result = await pg.query(envModule.toPositional(sql), args); return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 }; };
const env = { DB: envModule.makeDatabase(async () => execute), TELEGRAM_BOT_TOKEN: "TEST_ONLY", TELEGRAM_CHAT_ID: "123456", TELEGRAM_OWNER_EMAIL: "alice@example.test" };
let user = { userId: "alice", email: "alice@example.test" };
const mocks = { "@/app/server/env": { env }, "@/app/server/owner-auth": { getOwnerUser: async () => user }, "@/app/lib/trade-manager": { parseStoredTrades: value => JSON.parse(value).filter(item => item.id && item.entryPrice > 0) } };
const sync = load(new URL("../app/api/sync/route.ts", import.meta.url).pathname, mocks);
const request = (body, origin = "https://app.local") => ({ nextUrl: new URL("https://app.local/api/sync?scope=workspace"), headers: new Headers({ origin }), text: async () => JSON.stringify(body) });
const workspace = { symbol: "BTCUSDT", interval: "60", style: "DAY" };

test("Postgres: placeholder rewriting", () => {
  assert.equal(envModule.toPositional("SELECT ? , ? WHERE a=?"), "SELECT $1 , $2 WHERE a=$3");
});
test("Postgres: workspace sync insert, revision guard and conflict through the real route", async () => {
  assert.equal((await sync.PUT(request({ key: "workspace", value: workspace, revision: 0 }))).status, 200);
  assert.equal((await (await sync.GET(request())).json()).records[0].revision, 1);
  assert.equal((await sync.PUT(request({ key: "workspace", value: { ...workspace, symbol: "ETHUSDT" }, revision: 1 }))).status, 200);
  assert.equal((await sync.PUT(request({ key: "workspace", value: { ...workspace, symbol: "SOLUSDT" }, revision: 1 }))).status, 409);
  const final = await (await sync.GET(request())).json();
  assert.equal(final.records[0].value.symbol, "ETHUSDT");
  assert.equal(final.records[0].revision, 2);
  user = { userId: "bob", email: "bob@example.test" };
  assert.deepEqual((await (await sync.GET(request())).json()).records, []);
  user = { userId: "alice", email: "alice@example.test" };
});
test("Postgres: Telegram runtime lease, offset advance and delivery claim statements", async () => {
  const now = Date.now();
  const lease = await env.DB.prepare("INSERT INTO telegram_runtime(id,\"offset\",lease_until) VALUES('bot',0,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE telegram_runtime.lease_until<? RETURNING \"offset\"").bind(now + 45000, now).first();
  assert.equal(lease.offset, 0);
  assert.equal(typeof lease.offset, "number");
  const blocked = await env.DB.prepare("INSERT INTO telegram_runtime(id,\"offset\",lease_until) VALUES('bot',0,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE telegram_runtime.lease_until<? RETURNING \"offset\"").bind(now + 45000, now).first();
  assert.equal(blocked, null, "a live lease blocks a second poller");
  for (const id of [900000001, 900000000]) {
    await env.DB.prepare("UPDATE telegram_runtime SET \"offset\"=CASE WHEN \"offset\">? THEN \"offset\" ELSE ? END,lease_until=? WHERE id='bot'").bind(id + 1, id + 1, now + 45000).run();
  }
  await env.DB.prepare("UPDATE telegram_runtime SET lease_until=0 WHERE id='bot'").run();
  const after = await env.DB.prepare("INSERT INTO telegram_runtime(id,\"offset\",lease_until) VALUES('bot',0,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE telegram_runtime.lease_until<? RETURNING \"offset\"").bind(now + 45000, now).first();
  assert.equal(after.offset, 900000002, "offset never moves backwards");
  assert.ok((await env.DB.prepare("INSERT INTO telegram_updates(id,received_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(900000001, now).first()));
  assert.equal(await env.DB.prepare("INSERT INTO telegram_updates(id,received_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(900000001, now).first(), null);
  assert.ok(await env.DB.prepare("INSERT INTO telegram_deliveries(user_id,signal_key,status,created_at) VALUES(?,?,'PENDING',?) ON CONFLICT(user_id,signal_key) DO NOTHING RETURNING status").bind("alice", "k1", now).first());
  assert.equal(await env.DB.prepare("INSERT INTO telegram_deliveries(user_id,signal_key,status,created_at) VALUES(?,?,'PENDING',?) ON CONFLICT(user_id,signal_key) DO NOTHING RETURNING status").bind("alice", "k1", now).first(), null);
  await env.DB.prepare("UPDATE telegram_deliveries SET status='SENT' WHERE user_id=? AND signal_key=?").bind("alice", "k1").run();
  await env.DB.prepare("INSERT INTO account_records(user_id,record_key,payload,revision,updated_at) VALUES(?,'telegram',?,1,?) ON CONFLICT(user_id,record_key) DO UPDATE SET payload=excluded.payload,revision=account_records.revision+1,updated_at=excluded.updated_at").bind("alice", JSON.stringify({ chatId: "123456", enabled: false }), now).run();
  const saved = await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key='telegram'").bind("alice").first();
  assert.equal(JSON.parse(saved.payload).enabled, false);
  const trades = await env.DB.prepare("SELECT payload FROM account_records WHERE user_id=? AND record_key LIKE 'trade/%' ORDER BY updated_at DESC LIMIT 15").bind("alice").all();
  assert.deepEqual(trades.results, []);
});
test("Postgres: login rate limiting statements", async () => {
  const now = Date.now(), bucket = Math.floor(now / 900_000);
  let attempts = 0;
  for (let i = 0; i < 3; i++) attempts = (await env.DB.prepare("INSERT INTO login_attempts(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=login_attempts.attempts+1 RETURNING attempts").bind("ip:" + bucket, (bucket + 1) * 900_000).first()).attempts;
  assert.equal(attempts, 3);
  await env.DB.prepare("DELETE FROM login_attempts WHERE expires_at < ?").bind(now - 900_000).run();
});
