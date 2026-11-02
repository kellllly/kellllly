import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const itsmWorkspaceTable = pgTable("anif_itsm_workspace", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().default(1),
  store: jsonb("store").$type<Record<string, unknown>>().notNull(),
  importedUsers: text("imported_users").array().notNull().default(sql`ARRAY[]::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
