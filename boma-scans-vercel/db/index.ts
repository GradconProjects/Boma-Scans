import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/** Drizzle handle for Turso/libSQL. Routes use the raw statement adapter in app/server/env.ts. */
export function getDb() {
  const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set.");
  return drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined }), { schema });
}
