import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const accountRecords = sqliteTable("account_records", {
  userId: text("user_id").notNull(),
  key: text("record_key").notNull(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [primaryKey({columns:[table.userId,table.key]})]);
export const telegramDeliveries = sqliteTable("telegram_deliveries", {
  userId: text("user_id").notNull(),
  signalKey: text("signal_key").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [primaryKey({columns:[table.userId,table.signalKey]})]);
export const telegramRuntime=sqliteTable("telegram_runtime",{
 id:text("id").primaryKey(),offset:integer("offset").notNull(),leaseUntil:integer("lease_until").notNull(),
});
export const telegramUpdates=sqliteTable("telegram_updates",{
 id:integer("id").primaryKey(),receivedAt:integer("received_at").notNull(),
});
export const loginAttempts=sqliteTable("login_attempts",{
 key:text("key").primaryKey(),attempts:integer("attempts").notNull(),expiresAt:integer("expires_at").notNull(),
});
