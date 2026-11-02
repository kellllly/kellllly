import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Development test receiver only; not an independent/WORM production archive.
export const itsmDevelopmentRoleArchiveTable = pgTable("anif_itsm_development_role_archive", {
  eventId: text("event_id").primaryKey(),
  digest: text("digest").notNull(),
  envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertItsmDevelopmentRoleArchiveSchema = createInsertSchema(itsmDevelopmentRoleArchiveTable)
  .omit({ receivedAt: true });
export type ItsmDevelopmentRoleArchive = typeof itsmDevelopmentRoleArchiveTable.$inferSelect;
